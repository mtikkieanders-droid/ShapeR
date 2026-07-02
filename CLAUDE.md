# CLAUDE.md

Fork van Meta's ShapeR (3D-meshes uit casual captures) uitgebreid met eigen
tooling. Mix van upstream research-code (niet herformatteren) en eigen werk.

## Indeling

- `infer_shape.py`, `model/`, `dataset/`, `pre/postprocessing/` — upstream
  ShapeR-inferentie. GPU-only (CUDA 12.8, legacy torchsparse-fork, flash-attn).
  `model/dinov2/` is gevendorde upstream DINOv2: niet aanpassen.
- `experimental/` — eigen foto→ShapeR pipeline (Depth-Anything-V3):
  `prepare_capture.py` (CLI) + `capture_utils.py`. Pickle-contract moet
  matchen met `dataset/shaper_dataset.py::InferenceDataset`.
- `viewer/` — drag-and-drop GLB-viewer (three.js, gevendorde bundle).
- `container-planner/` — klantproject: containers stapelen op een gaussian
  splat (three.js + @sparkjsdev/spark). Nederlandstalige UI. Hoort op termijn
  in een eigen repo + GitHub Pages.
- `scripts/` — `setup_env.sh` (GPU-machine install) en `smoke_test.py`
  (gelaagde installcheck; CPU-lagen moeten overal slagen).

## Werken in deze repo

- Geen GPU in cloud/CI: het model zelf draaien kan alleen op een machine met
  NVIDIA-GPU. CPU-verifieerbaar: `python scripts/smoke_test.py` (CUDA-checks
  rapporteren dan SKIP), synthetische pipeline-tests, en de webapps headless.
- Webapps testen met Playwright + Chromium
  (`--use-gl=angle --enable-unsafe-swiftshader`); beide apps exposen een
  `window.__planner`/test-hook. Vendor-bundles worden met esbuild gebouwd —
  rebuild-instructies staan in de README van elke app-map.
- Afspraak: GLB is overal het uitwisselformaat (ShapeR-output → viewer →
  Blender/Unreal → planner), alles metrisch, ShapeR-wereld is Z-up.
- Upstream-bestanden alleen aanraken als het echt nodig is; eigen werk leeft
  in `experimental/`, `viewer/`, `container-planner/`, `scripts/`.
