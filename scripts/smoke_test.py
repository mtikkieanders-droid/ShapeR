#!/usr/bin/env python3
"""Layered installation smoke test for ShapeR.

Run after scripts/setup_env.sh (or a manual INSTALL.md install):

    python scripts/smoke_test.py

Layers:
  1. core        pip packages that must import everywhere (CPU or GPU)
  2. cuda        torch can see a GPU
  3. cuda-build  flash-attn / torch-cluster / torchsparse, plus the
                 SparseTensor-on-GPU check from INSTALL.md step 5
  4. repo        ShapeR's own inference modules import cleanly

On a machine without a GPU the CUDA-only checks report SKIP instead of FAIL,
so the test is still useful on CPU-only boxes. On the inference machine
everything must PASS. Exit code is non-zero iff any check FAILs.
"""

import importlib
import sys
import traceback
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

# Packages that only exist on a CUDA install; their absence on a CPU-only
# machine downgrades a failure to SKIP.
CUDA_ONLY_PACKAGES = {"torchsparse", "flash_attn", "torch_cluster"}

CORE_IMPORTS = [
    "numpy",
    "torch",
    "torchvision",
    "PIL",
    "cv2",
    "trimesh",
    "transformers",
    "diffusers",
    "omegaconf",
    "hydra",
    "sklearn",
    "skimage",
    "einops",
    "timm",
    "imageio",
    "matplotlib",
    "plyfile",
    "pymeshlab",
    "tqdm",
]

REPO_IMPORTS = [
    "dataset.shaper_dataset",
    "model.flow_matching.shaper_denoiser",
    "model.vae3d.autoencoder",
    "model.text.hf_embedder",
    "postprocessing.helper",
]

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results = []


def record(layer, name, status, detail=""):
    results.append((layer, name, status, detail))
    line = f"[{status}] {layer:<10} {name}"
    if detail:
        line += f"  ({detail})"
    print(line)


def missing_module(exc):
    """Return the top-level module name a ModuleNotFoundError refers to."""
    if isinstance(exc, ModuleNotFoundError) and exc.name:
        return exc.name.split(".")[0]
    return None


def try_import(layer, module, cuda_available):
    try:
        importlib.import_module(module)
        record(layer, module, PASS)
        return True
    except Exception as exc:  # noqa: BLE001 - report anything that breaks import
        missing = missing_module(exc)
        if missing in CUDA_ONLY_PACKAGES and not cuda_available:
            record(layer, module, SKIP, f"needs {missing}, no CUDA on this machine")
        else:
            record(layer, module, FAIL, f"{type(exc).__name__}: {exc}")
        return False


def main():
    print(f"ShapeR smoke test (repo root: {REPO_ROOT})\n")

    # Layer 1: core imports -------------------------------------------------
    for module in CORE_IMPORTS:
        try_import("core", module, cuda_available=False)

    # Layer 2: CUDA ----------------------------------------------------------
    cuda_available = False
    try:
        import torch

        cuda_available = torch.cuda.is_available()
        if cuda_available:
            record("cuda", "torch.cuda.is_available", PASS, torch.cuda.get_device_name(0))
        else:
            record("cuda", "torch.cuda.is_available", SKIP,
                   "no GPU here — required on the inference machine")
    except Exception as exc:  # noqa: BLE001
        record("cuda", "torch.cuda.is_available", FAIL, f"{type(exc).__name__}: {exc}")

    # Layer 3: CUDA-build packages -------------------------------------------
    for module in ("flash_attn", "torch_cluster", "torchsparse"):
        try_import("cuda-build", module, cuda_available)

    if cuda_available:
        try:
            import torch
            from torchsparse import SparseTensor

            x = SparseTensor(
                coords=torch.tensor([[1, 2, 3, 0], [4, 5, 6, 1]], dtype=torch.int32),
                feats=torch.randn(2, 4),
            )
            x = x.cuda()
            record("cuda-build", "SparseTensor.cuda()", PASS)
        except Exception as exc:  # noqa: BLE001
            record("cuda-build", "SparseTensor.cuda()", FAIL, f"{type(exc).__name__}: {exc}")
    else:
        record("cuda-build", "SparseTensor.cuda()", SKIP, "no CUDA on this machine")

    # Layer 4: repo modules ----------------------------------------------------
    for module in REPO_IMPORTS:
        try_import("repo", module, cuda_available)

    # Summary ------------------------------------------------------------------
    counts = {s: sum(1 for r in results if r[2] == s) for s in (PASS, FAIL, SKIP)}
    print(f"\n{counts[PASS]} passed, {counts[FAIL]} failed, {counts[SKIP]} skipped")
    if counts[FAIL]:
        print("\nFailures:")
        for layer, name, status, detail in results:
            if status == FAIL:
                print(f"  - {layer}/{name}: {detail}")
        print("\nSee INSTALL.md > Troubleshooting.")
        return 1
    if counts[SKIP]:
        print("Skipped checks must pass on the GPU machine you run inference on.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - always show a full trace for unexpected errors
        traceback.print_exc()
        sys.exit(2)
