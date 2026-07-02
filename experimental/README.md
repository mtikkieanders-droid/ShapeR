# Experimental: photos → ShapeR → 3D mesh

The official ShapeR preprocessing (Aria MPS + 3D object instance detector) is
not part of this repository. This directory contains an experimental
replacement that turns ordinary photos into ShapeR inputs, using
[Depth-Anything-V3](https://github.com/ByteDance-Seed/Depth-Anything-3) for
metric depth + camera estimation.

| File | Purpose |
| --- | --- |
| `prepare_capture.py` | CLI: photo(s) + caption (+ masks) → ShapeR input pickle |
| `capture_utils.py` | Reusable geometry / masking / pickle-assembly functions |
| `workaround_dataproc.py` | Thin wrapper that processes the bundled `example/` |
| `example/` | Sample image, hand-made masks and caption |

## Setup

On top of the core environment (see `INSTALL.md`):

```bash
pip install -r requirements-experimental.txt
```

Depth-Anything-V3 and ShapeR inference both need a CUDA GPU.

## End-to-end recipe

1. **Photograph the object.** One photo works; several photos from different
   angles give a denser point cloud. Keep the object fully visible, ideally
   standing on a table or floor.

2. **Create the input pickle:**

   ```bash
   python experimental/prepare_capture.py \
       --images mug1.jpg mug2.jpg \
       --auto-mask \
       --caption "a ceramic coffee mug" \
       --out data/mug.pkl --preview
   ```

   - `--auto-mask` segments the object automatically (rembg). For tricky
     images, supply your own binary masks instead: `--fg-masks m1.png m2.png`
     (white = object). Interactive SAM2 works well for making these.
   - Add `--plane-masks ...` (white = supporting table/floor surface) to align
     the reconstruction to gravity; without it the orientation stays
     camera-relative.
   - `--preview` writes `data/mug.ply` (the point cloud that will condition
     ShapeR) and `data/mug.view*.jpg` (its projection into each view). Check
     these before burning GPU time: the PLY should look like the object, and
     the projections should land on the object in the photo.

3. **Run ShapeR inference** (GPU machine):

   ```bash
   python infer_shape.py --input_pkl data/mug.pkl --config balance --is_local_path
   ```

   The mesh is written to `output/mug.glb`. Add `--do_transform_to_world` to
   get it in the same frame as the Depth-Anything-V3 reconstruction.

4. **Inspect the mesh:** open `viewer/index.html` (see `viewer/README.md`) and
   drop the `.glb` in.

## Import into Blender / Unreal

The `.glb` output is directly usable:

- **Blender:** File → Import → glTF 2.0. ShapeR output is metric, Z-up —
  matching Blender's conventions.
- **Unreal Engine:** drag the `.glb` into the Content Browser (Interchange
  handles glTF). Unreal uses centimeters; set the import *Uniform Scale* to
  100 if the mesh comes in too small.

If you drive Blender or Unreal through their MCP servers, those connect to a
locally running instance — do that from a session on the machine where
Blender/Unreal runs, and point the import at the `.glb` files produced above.

## Known limitations

- The `experimental_dav3` loader in `dataset/image_processor.py` conditions
  the image branch on the **first** view only; extra views currently improve
  the point cloud, not the image conditioning. Put your best photo first.
- Depth-Anything-V3 metric scale can be off for unusual scenes; expect the
  mesh scale to be approximate.
- `--auto-mask` (rembg) is a general-purpose segmenter. If it grabs the wrong
  object, fall back to hand-made masks.
