# Mesh viewer

A self-contained drag-and-drop viewer for the `.glb` meshes that
`infer_shape.py` writes to `output/`. No install, no internet: three.js
(r180) is bundled in `vendor/three-bundle.js`.

## Usage

Open `viewer/index.html` directly in a browser, or serve the repo root:

```bash
python -m http.server 8000
# then browse to http://localhost:8000/viewer/
```

Drop a `.glb`/`.gltf` onto the page (or use **Open…**).

| Control | Key | |
| --- | --- | --- |
| Wireframe | `W` | toggle wireframe rendering |
| Z-up | `Z` | rotate a Z-up mesh (ShapeR convention) upright |
| Grid | `G` | toggle floor grid + axes |
| Reset view | `R` | re-frame the camera on the model |

The panel at the bottom left shows vertex/triangle counts and the bounding
box size — ShapeR outputs are metric, so those numbers are in meters.

## Rebuilding the vendored bundle

```bash
npm install three@0.180.0 esbuild
esbuild entry.js --bundle --minify --format=iife --outfile=vendor/three-bundle.js
```

where `entry.js` imports `three`, `GLTFLoader` and `OrbitControls` and puts
them on `window` (see the top of `index.html` for what is expected).
