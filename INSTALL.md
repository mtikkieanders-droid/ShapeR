# Installation

## Quick path (recommended)

The scripted setup encodes all steps below in the right order and verifies the result:

```bash
conda create -n shaper python=3.10
conda activate shaper
bash scripts/setup_env.sh
python scripts/smoke_test.py
```

`scripts/smoke_test.py` reports PASS/FAIL/SKIP per layer (core imports, CUDA,
CUDA-built packages, ShapeR modules); everything must PASS on the machine you
run inference on. For the experimental photo-to-3D preprocessing pipeline,
additionally run `pip install -r requirements-experimental.txt`.

The manual steps below remain as reference and for troubleshooting.

## Requirements

- Python 3.10
- CUDA 12.8 (or compatible version)
- Conda (recommended)

## Step 1: Create Conda Environment

```bash
conda create -n shaper python=3.10
conda activate shaper
```

## Step 2: Set Up CUDA Environment

Ensure CUDA is properly configured. Adjust paths based on your system:

```bash
export CUDA_HOME=/path/to/cuda
export CUDA_INCLUDE=$CUDA_HOME/include
export CUDA_LIB=$CUDA_HOME/lib
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:$CUDA_LIB
export LIBRARY_PATH=$LIBRARY_PATH:$CUDA_LIB
export CFLAGS="-I$CUDA_HOME/include"
export CXXFLAGS="-I$CUDA_HOME/include"
export CPATH="$CUDA_HOME/include:$CPATH"
```

## Step 3: Install Python Packages

```bash
conda install -c conda-forge gcc_linux-64=11 gxx_linux-64=11
conda install -c conda-forge sparsehash
pip install wheel setuptools ninja
pip install numpy tqdm hydra-core matplotlib opencv-python imageio easydict munch plyfile
pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
pip install transformers trimesh scikit-image diffusers gradio peft einops
pip install flash-attn --no-build-isolation --no-cache-dir
pip install "imageio[ffmpeg]" "imageio[pyav]"
pip install pymeshlab sophuspy fast_simplification scikit-learn timm plotly torchdiffeq sentencepiece protobuf pyrender jupyter
```

## Step 4: Install Torch-Cluster and Torchsparse

```bash
pip install torch-cluster -f https://data.pyg.org/whl/torch-2.7.1+cu128.html
pip install --verbose git+https://github.com/nihalsid/torchsparse@legacy --no-build-isolation
```

**Note:** The legacy version of torchsparse is required. Newer versions have incompatible data structures. This step takes a while, be patient.

## Step 5: Verify Installation

```bash
python -c "import torch; from torchsparse import SparseTensor;
x = SparseTensor(coords=torch.tensor([[1,2,3,0], [4,5,6,1]], dtype=torch.int32), feats=torch.randn(2, 4));
x = x.cuda();
print('Installation successful!')"
```

## Troubleshooting

### Torchsparse build fails
- Ensure sparsehash headers are in your include path (`CPATH`)
- Ensure CUDA environment variables are set correctly
- Try building with verbose output to see specific errors

### Flash attention build fails
- Ensure you have a compatible GPU (Ampere or newer recommended)
- Check that CUDA toolkit matches your PyTorch CUDA version

### Import errors
- Verify all packages installed correctly: `pip list | grep torch`
- Check CUDA availability: `python -c "import torch; print(torch.cuda.is_available())"`
