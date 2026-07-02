#!/usr/bin/env python3
"""
Reusable building blocks for converting casual photo captures into the pickle
format expected by ShapeR (see dataset/shaper_dataset.py::InferenceDataset).

The geometry code originates from workaround_dataproc.py; this module adds a
view-count-agnostic `prepare_sample` that assembles the full pickle dict, plus
helpers for mask loading, automatic foreground segmentation (rembg) and
point-cloud previews.
"""

import io
import pickle
from pathlib import Path

import fpsample
import numpy as np
import torch
from PIL import Image
from sklearn.cluster import DBSCAN
from sklearn.linear_model import RANSACRegressor


# =============================================================================
# Constants
# =============================================================================

# Transform from Y-down (OpenCV convention) to Z-up (ShapeR convention)
T_Y_DOWN_TO_Z_UP = np.array([
    [1,  0,  0, 0],
    [0,  0,  1, 0],
    [0, -1,  0, 0],
    [0,  0,  0, 1],
], dtype=np.float64)


# =============================================================================
# Geometry Utilities
# =============================================================================

def to_homogeneous_44(ext: np.ndarray) -> np.ndarray:
    """
    Convert (N, 3, 4) extrinsics to (N, 4, 4) homogeneous matrices.

    Args:
        ext: Extrinsic matrices of shape (N, 3, 4) or (N, 4, 4)

    Returns:
        Homogeneous matrices of shape (N, 4, 4)
    """
    if ext.shape[-2:] == (4, 4):
        return ext
    N = ext.shape[0]
    out = np.zeros((N, 4, 4), dtype=ext.dtype)
    out[:, :3, :4] = ext
    out[:, 3, 3] = 1.0
    return out


def world2cam_to_cam2world(world2cam: np.ndarray) -> np.ndarray:
    """
    Invert world-to-camera matrices to get camera-to-world matrices.

    Args:
        world2cam: World-to-camera matrices of shape (N, 4, 4)

    Returns:
        Camera-to-world matrices of shape (N, 4, 4)
    """
    cam2worlds = []
    for idx in range(len(world2cam)):
        cam2worlds.append(np.linalg.inv(world2cam[idx])[None, :, :])
    return np.concatenate(cam2worlds, axis=0)


def apply_transform_to_points(points: np.ndarray, transform: np.ndarray) -> np.ndarray:
    """
    Apply a 4x4 homogeneous transform to a point cloud.

    Args:
        points: Point cloud of shape (N, 3)
        transform: 4x4 transformation matrix

    Returns:
        Transformed points of shape (N, 3)
    """
    ones = np.ones((points.shape[0], 1))
    points_h = np.hstack([points, ones])
    points_h = (transform @ points_h.T).T
    return points_h[:, :3]


def center_box(points: np.ndarray) -> tuple:
    """
    Center a point cloud at the origin using bounding box center.

    Args:
        points: Point cloud of shape (N, 3)

    Returns:
        Tuple of (centered_points, centering_transform)
    """
    p_min = np.min(points, axis=0)
    p_max = np.max(points, axis=0)
    centroid = (p_min + p_max) / 2
    points_centered = points - centroid

    T = np.eye(4)
    T[:3, 3] = -centroid
    return points_centered, T


# =============================================================================
# Depth Processing
# =============================================================================

def merge_depth_maps_to_pointcloud(
    depths: np.ndarray,
    intrinsics: np.ndarray,
    extrinsics: np.ndarray,
    images: np.ndarray = None,
    conf: np.ndarray = None,
    conf_thresh: float = 0.0,
    remove_bottom_percentile: float = 15.0,
) -> np.ndarray:
    """
    Merge multiple depth maps into a single world-space point cloud.

    Args:
        depths: Depth maps of shape (N, H, W)
        intrinsics: Camera intrinsics of shape (N, 3, 3)
        extrinsics: World-to-camera matrices of shape (N, 3, 4) or (N, 4, 4)
        images: Optional RGB images of shape (N, H, W, 3)
        conf: Optional confidence maps of shape (N, H, W)
        conf_thresh: Minimum confidence threshold
        remove_bottom_percentile: Remove bottom X% of points by confidence

    Returns:
        Merged point cloud of shape (M, 3)
    """
    N, H, W = depths.shape
    extrinsics = to_homogeneous_44(extrinsics)

    # Create pixel coordinate grid
    us, vs = np.meshgrid(np.arange(W), np.arange(H))
    ones = np.ones_like(us)
    pix = np.stack([us, vs, ones], axis=-1).reshape(-1, 3)

    pts_all, conf_all = [], []

    for i in range(N):
        d = depths[i]

        # Build validity mask
        valid = np.isfinite(d) & (d > 0)
        if conf is not None:
            valid &= conf[i] >= conf_thresh
        if not np.any(valid):
            continue

        d_flat = d.reshape(-1)
        vidx = np.flatnonzero(valid.reshape(-1))

        # Unproject to camera space then transform to world space
        K_inv = np.linalg.inv(intrinsics[i])
        c2w = np.linalg.inv(extrinsics[i])

        rays = K_inv @ pix[vidx].T
        Xc = rays * d_flat[vidx][None, :]
        Xc_h = np.vstack([Xc, np.ones((1, Xc.shape[1]))])
        Xw = (c2w @ Xc_h)[:3].T.astype(np.float32)

        pts_all.append(Xw)

        if conf is not None:
            conf_all.append(conf[i].reshape(-1)[vidx])

    if len(pts_all) == 0:
        return np.zeros((0, 3), dtype=np.float32)

    points = np.concatenate(pts_all, axis=0)

    # Remove bottom percentile by confidence
    if conf is not None and remove_bottom_percentile > 0 and len(conf_all) > 0:
        conf_merged = np.concatenate(conf_all, axis=0)
        percentile_thresh = np.percentile(conf_merged, remove_bottom_percentile)
        keep_mask = conf_merged >= percentile_thresh
        points = points[keep_mask]

    return points


# =============================================================================
# Plane Alignment
# =============================================================================

def align_to_xy_plane(
    all_points: np.ndarray,
    xy_points_noisy: np.ndarray,
    target_normal: tuple = (0, 1, 0),
) -> tuple:
    """
    Align point cloud so that a reference plane becomes horizontal (Y=0).

    Uses RANSAC to robustly fit a plane to noisy reference points, then computes
    a rotation to align the plane normal with the target normal.

    Args:
        all_points: Full point cloud to transform, shape (N, 3)
        xy_points_noisy: Points on the reference plane (e.g., table surface), shape (M, 3)
        target_normal: Desired plane normal after alignment (default: Y-up)

    Returns:
        Tuple of (aligned_points, alignment_transform)
    """
    # Fit plane using RANSAC: y = c0*x + c1*z + intercept
    X_z = xy_points_noisy[:, [0, 2]]  # Features: X and Z
    y_h = xy_points_noisy[:, 1]        # Target: Y

    ransac = RANSACRegressor(min_samples=3, residual_threshold=0.01, random_state=42)
    ransac.fit(X_z, y_h)

    # Extract plane normal from coefficients
    # Plane equation: c0*x - 1*y + c1*z + intercept = 0
    c0, c1 = ransac.estimator_.coef_
    normal = np.array([c0, -1, c1])
    normal = normal / np.linalg.norm(normal)

    # Find centroid of inlier points
    inlier_mask = ransac.inlier_mask_
    inlier_points = xy_points_noisy[inlier_mask]
    centroid = np.mean(inlier_points, axis=0)

    # Compute rotation to align normal with target
    target_normal = np.array(target_normal)
    target_normal = target_normal / np.linalg.norm(target_normal)

    # Ensure normal points in same hemisphere as target
    if np.dot(normal, target_normal) < 0:
        normal = -normal

    # Rodrigues rotation formula
    v = np.cross(normal, target_normal)
    c_val = np.dot(normal, target_normal)
    I = np.eye(3)
    vx = np.array([
        [0, -v[2], v[1]],
        [v[2], 0, -v[0]],
        [-v[1], v[0], 0]
    ])

    if c_val > 0.99999:
        R = I
    elif c_val < -0.99999:
        R = -I
        R[0, 0] = 1
    else:
        s = 1 / (1 + c_val)
        R = I + vx + np.matmul(vx, vx) * s

    # Build transform: rotate then translate to put floor at Y=0
    rotated_centroid = np.dot(R, centroid)
    T = np.eye(4)
    T[:3, :3] = R
    T[1, 3] = -rotated_centroid[1]

    aligned_points = apply_transform_to_points(all_points, T)

    return aligned_points, T


# =============================================================================
# Point Cloud Filtering
# =============================================================================

def dbscan_filter(
    points: np.ndarray,
    eps: float = 0.05,
    min_samples: int = 32,
) -> np.ndarray:
    """
    Filter point cloud using DBSCAN clustering, keeping only clustered points.

    Removes noise/outlier points that don't belong to any dense cluster.

    Args:
        points: Input point cloud of shape (N, 3)
        eps: Maximum distance between neighbors in a cluster
        min_samples: Minimum points required to form a cluster

    Returns:
        Filtered point cloud with outliers removed
    """
    labels = DBSCAN(eps=eps, min_samples=min_samples).fit(points).labels_
    mask = labels != -1  # Keep non-noise points
    return points[mask]


# =============================================================================
# Visualization Utilities
# =============================================================================

def plot_dots(uv: np.ndarray, W: int, H: int) -> np.ndarray:
    """
    Rasterize 2D points into a grayscale image.

    Args:
        uv: 2D point coordinates of shape (N, 2)
        W: Image width
        H: Image height

    Returns:
        Grayscale image of shape (H, W) with points rasterized
    """
    img = np.zeros((H, W), dtype=np.float32)

    x = np.clip(uv[:, 0], 0, W - 1).astype(int)
    y = np.clip(uv[:, 1], 0, H - 1).astype(int)
    np.add.at(img, (y, x), 1)

    return (img * 255).astype(np.uint8)


def project_points_to_image(
    points_world: np.ndarray,
    camera_intrinsics: np.ndarray,
    cam2world: np.ndarray,
    W: int,
    H: int,
) -> np.ndarray:
    """
    Project 3D world points onto image plane and rasterize.

    Args:
        points_world: 3D points in world space, shape (N, 3)
        camera_intrinsics: 3x3 camera intrinsic matrix
        cam2world: 4x4 camera-to-world transform
        W: Image width
        H: Image height

    Returns:
        Rasterized image showing projected points
    """
    K = camera_intrinsics[:3, :3]
    world2cam = np.linalg.inv(cam2world)

    # Transform to camera space
    points_camera = (world2cam[:3, :3] @ points_world.T).T + world2cam[:3, 3]

    # Project to image plane
    points_image = (K @ points_camera.T).T
    points_image = points_image / points_image[:, 2:3]

    # Filter to valid image coordinates
    valid_mask = (
        (points_image[:, 0] > 0)
        & (points_image[:, 0] < W)
        & (points_image[:, 1] > 0)
        & (points_image[:, 1] < H)
    )
    points_image = points_image[valid_mask]

    return plot_dots(points_image[:, :2], W, H)


# =============================================================================
# Image / Mask Handling
# =============================================================================

def jpg_encode(image: np.ndarray) -> bytes:
    """
    Encode numpy image array to JPEG bytes.

    Args:
        image: Image array of shape (H, W) or (H, W, 3)

    Returns:
        JPEG-encoded bytes
    """
    image = Image.fromarray(image)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def load_grayscale_image(path, target_size: tuple) -> np.ndarray:
    """
    Load an image, resize to (W, H) and convert to grayscale.

    The released ShapeR checkpoint expects grayscale input.
    """
    return np.array(
        Image.open(path).resize(target_size, resample=Image.LANCZOS).convert("L")
    )


def load_binary_mask(path, target_size: tuple) -> np.ndarray:
    """
    Load a binary mask image and resize to (W, H), returning floats in [0, 1].
    """
    mask = Image.open(path).convert("L").resize(target_size, resample=Image.NEAREST)
    return np.array(mask) / 255


def auto_foreground_mask(image_path, target_size: tuple) -> np.ndarray:
    """
    Estimate a foreground object mask with rembg (background removal).

    Returns a float mask in [0, 1] at (H, W) for the given target size.
    Requires the optional `rembg` dependency (requirements-experimental.txt).
    """
    try:
        from rembg import remove
    except ImportError as exc:
        raise ImportError(
            "rembg is required for --auto-mask; "
            "install it with: pip install -r requirements-experimental.txt"
        ) from exc

    mask = remove(Image.open(image_path), only_mask=True)
    mask = mask.resize(target_size, resample=Image.NEAREST)
    return (np.array(mask) > 127).astype(np.float64)


# =============================================================================
# Sample Assembly
# =============================================================================

def prepare_sample(
    depths: np.ndarray,
    intrinsics: np.ndarray,
    extrinsics: np.ndarray,
    images_gray: list,
    fg_masks: np.ndarray,
    caption: str,
    plane_masks: np.ndarray = None,
    conf: np.ndarray = None,
    conf_thresh: float = 1.0,
    max_points: int = 1024,
) -> tuple:
    """
    Convert per-view depth predictions + masks into a ShapeR inference pickle.

    Follows the exact processing order of workaround_dataproc.py, generalized
    to N views: unproject masked depths, align to the ground plane (when plane
    masks are given), convert to Z-up, center, DBSCAN-filter and FPS-downsample.

    Args:
        depths: Metric depth maps, shape (N, H, W)
        intrinsics: Camera intrinsics, shape (N, 3, 3)
        extrinsics: World-to-camera matrices, shape (N, 3, 4) or (N, 4, 4)
        images_gray: N grayscale images (H, W) at depth resolution (uint8)
        fg_masks: Foreground object masks in [0, 1], shape (N, H, W)
        caption: Text description of the object (ShapeR is text-conditioned)
        plane_masks: Optional ground-plane masks in [0, 1], shape (N, H, W).
            Without them, no gravity alignment is performed (identity).
        conf: Optional per-pixel confidence maps, shape (N, H, W)
        conf_thresh: Minimum confidence for a depth pixel to be used
        max_points: FPS target size of the final point cloud

    Returns:
        Tuple of (pkl_sample dict, debug dict with intermediate results)
    """
    extrinsics = to_homogeneous_44(np.asarray(extrinsics))

    merge_kwargs = dict(
        intrinsics=intrinsics,
        extrinsics=extrinsics,
        conf=conf,
        conf_thresh=conf_thresh,
        remove_bottom_percentile=5.0,
    )

    # Raw (unmasked) cloud, kept in the pickle for reference/world alignment
    raw_metric_depth = merge_depth_maps_to_pointcloud(depths=depths, **merge_kwargs)

    # Object points
    points_foreground = merge_depth_maps_to_pointcloud(
        depths=depths * fg_masks, **merge_kwargs
    )
    if points_foreground.shape[0] < 4:
        raise ValueError(
            "Foreground mask yields almost no 3D points — check the mask "
            "(or the confidence threshold) and try again."
        )

    # Ground-plane alignment: with a plane mask we estimate gravity from the
    # supporting surface; without one we keep the camera-relative orientation.
    if plane_masks is not None:
        points_xyplane = merge_depth_maps_to_pointcloud(
            depths=depths * plane_masks, **merge_kwargs
        )
        points_aligned, T_align = align_to_xy_plane(points_foreground, points_xyplane)
    else:
        points_aligned, T_align = points_foreground, np.eye(4)

    # Convert from Y-down to Z-up coordinate system and center at origin
    points_z_up = apply_transform_to_points(points_aligned, T_Y_DOWN_TO_Z_UP)
    _, T_center = center_box(points_z_up)
    points_centered = apply_transform_to_points(points_z_up, T_center)

    # Transform all camera poses to match the point cloud
    camera_poses = world2cam_to_cam2world(extrinsics)
    camera_poses = np.stack([
        T_center @ T_Y_DOWN_TO_Z_UP @ T_align @ pose for pose in camera_poses
    ])

    # Normalize scale, filter outliers, downsample
    half_size = (points_centered.max(axis=0) - points_centered.min(axis=0)) / 2
    scale = 0.9 / np.max(half_size)
    points_scaled = points_centered * scale
    points_scaled = dbscan_filter(points_scaled, eps=0.1, min_samples=8)
    if points_scaled.shape[0] < 4:
        raise ValueError(
            "DBSCAN filtering removed nearly all points — the foreground "
            "points are too sparse or too noisy."
        )
    if points_scaled.shape[0] > 16:
        n_samples = min(max_points, points_scaled.shape[0])
        fps_idx = fpsample.fps_sampling(points_scaled, n_samples)
        points_scaled = points_scaled[fps_idx, :]
    # Undo scale for final output (ShapeR handles normalization internally)
    points_final = points_scaled / scale

    # Per-view projection masks of the final point cloud
    H, W = depths.shape[-2:]
    point_masks = [
        project_points_to_image(points_final, intrinsics[v], camera_poses[v], W, H)
        for v in range(len(depths))
    ]

    points_tensor = torch.from_numpy(points_final).float()
    pkl_sample = {
        # Point cloud and geometry
        "points_model": points_tensor,
        "bounds": torch.from_numpy(half_size).float(),
        "T_model_world": torch.from_numpy(T_center @ T_Y_DOWN_TO_Z_UP @ T_align),

        # Uncertainty estimates (zeros: dense depth has no per-point std)
        "inv_dist_std": torch.zeros_like(points_tensor)[:, 0],
        "dist_std": torch.zeros_like(points_tensor)[:, 0],

        # Image and camera data (one entry per view; note that the
        # experimental_dav3 loader currently conditions on view 0 only)
        "image_data": [jpg_encode(img) for img in images_gray],
        "camera_to_worlds": [
            torch.from_numpy(pose).float() for pose in camera_poses
        ],
        "camera_params": [torch.from_numpy(K) for K in intrinsics],
        "mask_data": [jpg_encode(m) for m in point_masks],

        # Metadata
        "caption": caption,
        "experimental_dav3": True,
        "raw_depth": torch.from_numpy(raw_metric_depth),
    }

    debug = {
        "points_final": points_final,
        "camera_poses": camera_poses,
        "point_masks": point_masks,
        "num_raw_points": int(raw_metric_depth.shape[0]),
        "num_foreground_points": int(points_foreground.shape[0]),
    }
    return pkl_sample, debug


def save_sample(pkl_sample: dict, output_path) -> None:
    """Write a ShapeR sample dict to a pickle file."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        pickle.dump(pkl_sample, f)


def save_pointcloud_ply(points: np.ndarray, path) -> None:
    """Write a point cloud to an ASCII PLY file for quick visual inspection."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        f.write(
            "ply\nformat ascii 1.0\n"
            f"element vertex {points.shape[0]}\n"
            "property float x\nproperty float y\nproperty float z\n"
            "end_header\n"
        )
        for p in points:
            f.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
