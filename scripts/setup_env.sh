#!/usr/bin/env bash
# Reproducible environment setup for ShapeR.
#
# Encodes the exact install order from INSTALL.md: torch and friends first,
# then flash-attn / torch-cluster / torchsparse, which must compile against
# the torch that is already installed. Run inside your (conda) environment:
#
#   conda create -n shaper python=3.10 && conda activate shaper
#   bash scripts/setup_env.sh
#   python scripts/smoke_test.py

set -euo pipefail

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- Python sanity ----------------------------------------------------------
command -v python >/dev/null 2>&1 \
  || die "python not found — activate your environment first (conda activate shaper)"
PYV="$(python -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
if [ "$PYV" != "3.10" ]; then
  echo "WARNING: Python $PYV detected; ShapeR is tested with Python 3.10."
fi

# --- CUDA environment (INSTALL.md step 2) ------------------------------------
if [ -z "${CUDA_HOME:-}" ]; then
  for candidate in /usr/local/cuda-12.8 /usr/local/cuda; do
    if [ -d "$candidate" ]; then
      export CUDA_HOME="$candidate"
      break
    fi
  done
fi
[ -n "${CUDA_HOME:-}" ] \
  || die "CUDA_HOME is not set and no /usr/local/cuda* found. Install CUDA 12.8 (or compatible) or 'export CUDA_HOME=/path/to/cuda' first."
log "Using CUDA_HOME=$CUDA_HOME"

CUDA_LIB="$CUDA_HOME/lib64"
[ -d "$CUDA_LIB" ] || CUDA_LIB="$CUDA_HOME/lib"
export CUDA_INCLUDE="$CUDA_HOME/include"
export CUDA_LIB
export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}:$CUDA_LIB"
export LIBRARY_PATH="${LIBRARY_PATH:-}:$CUDA_LIB"
export CFLAGS="-I$CUDA_INCLUDE ${CFLAGS:-}"
export CXXFLAGS="-I$CUDA_INCLUDE ${CXXFLAGS:-}"
export CPATH="$CUDA_INCLUDE:${CPATH:-}"

# --- Compiler + sparsehash (INSTALL.md step 3, conda part) --------------------
if command -v conda >/dev/null 2>&1; then
  log "Installing gcc 11 and sparsehash via conda-forge"
  conda install -y -c conda-forge gcc_linux-64=11 gxx_linux-64=11 sparsehash
else
  echo "WARNING: conda not found — ensure gcc/g++ 11 and sparsehash headers are available (sparsehash must be on CPATH for the torchsparse build)."
fi

# --- Python packages ----------------------------------------------------------
log "Installing build tooling"
pip install wheel setuptools ninja

log "Installing core requirements (torch 2.7.1 cu128 + dependencies)"
pip install -r "$REPO_ROOT/requirements.txt"

log "Building flash-attn (compiles against installed torch — this takes a while)"
pip install flash-attn --no-build-isolation --no-cache-dir \
  || die "flash-attn build failed. You need an Ampere-or-newer GPU and a CUDA toolkit matching torch's cu128. See INSTALL.md > Troubleshooting."

log "Installing torch-cluster (prebuilt wheel for torch 2.7.1 + cu128)"
pip install torch-cluster -f https://data.pyg.org/whl/torch-2.7.1+cu128.html

log "Building torchsparse LEGACY fork (required — newer torchsparse is incompatible; slow, be patient)"
pip install --verbose "git+https://github.com/nihalsid/torchsparse@legacy" --no-build-isolation \
  || die "torchsparse build failed. Check that sparsehash headers are on CPATH and the CUDA env vars above are correct. See INSTALL.md > Troubleshooting."

log "Environment ready. Verify with: python $REPO_ROOT/scripts/smoke_test.py"
