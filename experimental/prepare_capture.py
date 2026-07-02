#!/usr/bin/env python3
"""
Photo(s) -> ShapeR input pipeline (experimental).

Turns one or more casual photos of an object into the pickle format that
infer_shape.py consumes, using Depth-Anything-V3 for metric depth and camera
estimation. Multiple photos of the same object are merged into a denser point
cloud (note: the experimental_dav3 loader currently conditions the image
branch on the first view only).

Requirements: core environment (INSTALL.md) plus
    pip install -r requirements-experimental.txt

Examples:
    # Single photo, automatic foreground segmentation (rembg):
    python experimental/prepare_capture.py \
        --images photo.jpg --auto-mask \
        --caption "a ceramic coffee mug" \
        --out data/mug.pkl --preview

    # Multiple photos with hand-made masks and ground-plane alignment:
    python experimental/prepare_capture.py \
        --images a.jpg b.jpg \
        --fg-masks a_fg.png b_fg.png \
        --plane-masks a_plane.png b_plane.png \
        --caption-file caption.txt --out data/chair.pkl

Then run inference on your GPU machine:
    python infer_shape.py --input_pkl data/mug.pkl --config balance --is_local_path
"""

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from capture_utils import (  # noqa: E402
    auto_foreground_mask,
    load_binary_mask,
    load_grayscale_image,
    prepare_sample,
    save_pointcloud_ply,
    save_sample,
    to_homogeneous_44,
)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Convert photos of an object into a ShapeR inference pickle.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--images", nargs="+", required=True,
        help="One or more photos of the same object.",
    )
    caption_group = parser.add_mutually_exclusive_group(required=True)
    caption_group.add_argument(
        "--caption", help="Text description of the object (ShapeR is text-conditioned)."
    )
    caption_group.add_argument(
        "--caption-file", help="File containing the text description."
    )
    mask_group = parser.add_mutually_exclusive_group(required=True)
    mask_group.add_argument(
        "--fg-masks", nargs="+",
        help="Binary foreground mask per image (white = object), same order as --images.",
    )
    mask_group.add_argument(
        "--auto-mask", action="store_true",
        help="Estimate foreground masks automatically with rembg.",
    )
    parser.add_argument(
        "--plane-masks", nargs="+",
        help="Optional binary mask per image of the supporting surface "
             "(table/floor), used to align the object to gravity. Without it "
             "the reconstruction keeps the camera-relative orientation.",
    )
    parser.add_argument(
        "--out", required=True, help="Output pickle path (e.g. data/mug.pkl)."
    )
    parser.add_argument(
        "--preview", action="store_true",
        help="Also write <out>.ply (final point cloud) and per-view "
             "<out>.view*.jpg projection images to inspect before inference.",
    )
    parser.add_argument(
        "--model", default="depth-anything/DA3NESTED-GIANT-LARGE",
        help="Depth-Anything-V3 model to use.",
    )
    parser.add_argument("--device", default="cuda:0", help="Device for DA3 inference.")
    parser.add_argument(
        "--conf-thresh", type=float, default=1.0,
        help="Minimum DA3 depth confidence for a pixel to be used.",
    )
    parser.add_argument(
        "--max-points", type=int, default=1024,
        help="FPS target size of the final point cloud.",
    )

    args = parser.parse_args(argv)

    if args.fg_masks and len(args.fg_masks) != len(args.images):
        parser.error("--fg-masks needs exactly one mask per image")
    if args.plane_masks and len(args.plane_masks) != len(args.images):
        parser.error("--plane-masks needs exactly one mask per image")
    for path in args.images + (args.fg_masks or []) + (args.plane_masks or []):
        if not Path(path).exists():
            parser.error(f"file not found: {path}")
    if args.caption_file and not Path(args.caption_file).exists():
        parser.error(f"file not found: {args.caption_file}")
    return args


def main(argv=None):
    args = parse_args(argv)
    caption = args.caption or Path(args.caption_file).read_text().strip()

    # Heavy imports after argument validation, so --help stays fast
    import torch
    from depth_anything_3.api import DepthAnything3

    print(f"Loading {args.model} on {args.device} ...")
    model = DepthAnything3.from_pretrained(args.model).to(device=torch.device(args.device))

    print(f"Estimating depth for {len(args.images)} image(s) ...")
    prediction = model.inference(image=list(args.images))
    target_size = (prediction.depth.shape[-1], prediction.depth.shape[-2])  # (W, H)

    images_gray = [load_grayscale_image(p, target_size) for p in args.images]

    if args.auto_mask:
        print("Segmenting foreground with rembg ...")
        fg_masks = np.stack([auto_foreground_mask(p, target_size) for p in args.images])
    else:
        fg_masks = np.stack([load_binary_mask(p, target_size) for p in args.fg_masks])

    plane_masks = None
    if args.plane_masks:
        plane_masks = np.stack(
            [load_binary_mask(p, target_size) for p in args.plane_masks]
        )
    else:
        print(
            "NOTE: no --plane-masks given; skipping gravity alignment "
            "(reconstruction keeps camera-relative orientation)."
        )

    pkl_sample, debug = prepare_sample(
        depths=prediction.depth,
        intrinsics=prediction.intrinsics,
        extrinsics=to_homogeneous_44(prediction.extrinsics),
        images_gray=images_gray,
        fg_masks=fg_masks,
        caption=caption,
        plane_masks=plane_masks,
        conf=prediction.conf,
        conf_thresh=args.conf_thresh,
        max_points=args.max_points,
    )

    save_sample(pkl_sample, args.out)
    print(
        f"Saved {args.out} "
        f"({debug['num_foreground_points']} object points before filtering, "
        f"{pkl_sample['points_model'].shape[0]} in final cloud, caption: {caption!r})"
    )

    if args.preview:
        out = Path(args.out)
        ply_path = out.with_suffix(".ply")
        save_pointcloud_ply(debug["points_final"], ply_path)
        print(f"Preview point cloud: {ply_path}")
        from PIL import Image

        for v, mask in enumerate(debug["point_masks"]):
            view_path = out.with_suffix(f".view{v}.jpg")
            Image.fromarray(mask).save(view_path)
            print(f"Preview projection:  {view_path}")

    print("\nRun inference with:")
    print(f"  python infer_shape.py --input_pkl {args.out} --config balance --is_local_path")
    print("The resulting .glb lands in output/ — open it with viewer/index.html.")


if __name__ == "__main__":
    main()
