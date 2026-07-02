#!/usr/bin/env python3
"""
Depth-Anything-V3 to ShapeR Data Processor (example wrapper).

The original single-file workaround has been refactored into:
  - capture_utils.py     reusable geometry / mask / pickle-assembly functions
  - prepare_capture.py   general CLI (multi-image, auto-masking, previews)

This script keeps the original behavior: it processes the bundled example
(cup_painting.jpg with hand-made SAM2 masks) into example/cup_painting.pkl.

Usage:
    python workaround_dataproc.py

Requirements: core environment (INSTALL.md) plus
    pip install -r requirements-experimental.txt
"""

from pathlib import Path

from prepare_capture import main

if __name__ == "__main__":
    example = Path(__file__).resolve().parent / "example"
    main([
        "--images", str(example / "cup_painting.jpg"),
        "--fg-masks", str(example / "foreground.png"),
        "--plane-masks", str(example / "xy_plane.png"),
        "--caption-file", str(example / "caption.txt"),
        "--out", str(example / "cup_painting.pkl"),
    ])
