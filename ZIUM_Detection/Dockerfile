# ZIUM Detection — ROS 2 Foxy + CUDA + FoundationPose + YOLO
# Base image matches NVlabs/FoundationPose to preserve CUDA/CuDNN/OpenGL stack.
# FoundationPose.py expects conda env `my` at /opt/conda/envs/my (Python 3.8).
#
# Build:  docker build -t zium-detection:foxy-cu118 -f Dockerfile .
# Run:    see docker-compose.yml (requires --gpus all, --network=host)

FROM nvidia/cudagl:11.3.0-devel-ubuntu20.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Seoul \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    OPENCV_IO_ENABLE_OPENEXR=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=all

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ---------- system deps (subset of NVlabs/FoundationPose docker/dockerfile) ----------
RUN apt-get update --fix-missing && apt-get install -y --no-install-recommends \
    build-essential cmake g++ gcc gfortran pkg-config git wget curl ca-certificates \
    bzip2 vim tmux locales software-properties-common gnupg2 lsb-release \
    libgtk2.0-dev libjpeg8-dev libtiff5-dev yasm \
    libavcodec-dev libavformat-dev libswscale-dev libdc1394-22-dev \
    libxine2-dev libv4l-dev libtbb-dev libatlas-base-dev \
    libhdf5-dev libboost-all-dev libyaml-cpp-dev libflann-dev \
    freeglut3-dev libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender1 \
    x11-apps \
 && locale-gen en_US en_US.UTF-8 \
 && update-locale LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 \
 && rm -rf /var/lib/apt/lists/*

# ---------- pybind11 + eigen (FoundationPose C++ extensions) ----------
RUN cd /opt && git clone --depth 1 --branch v2.10.0 https://github.com/pybind/pybind11 \
 && cd pybind11 && mkdir build && cd build \
 && cmake .. -DCMAKE_BUILD_TYPE=Release -DPYBIND11_INSTALL=ON -DPYBIND11_TEST=OFF \
 && make -j$(nproc) && make install

RUN cd /opt && wget -q https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz \
 && tar xf eigen-3.4.0.tar.gz && cd eigen-3.4.0 \
 && mkdir build && cd build && cmake .. && make install \
 && rm /opt/eigen-3.4.0.tar.gz

# ---------- ROS 2 Foxy (EOL 2023-05; packages.ros.org/ros2 still serves focal main as frozen snapshot) ----------
RUN add-apt-repository universe \
 && curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(lsb_release -cs) main" > /etc/apt/sources.list.d/ros2.list \
 && apt-get update && apt-get install -y --no-install-recommends \
    ros-foxy-ros-base \
    ros-foxy-cv-bridge \
    ros-foxy-tf2-msgs \
    ros-foxy-tf2-ros \
    ros-foxy-rmw-fastrtps-cpp \
    python3-colcon-common-extensions \
    python3-argcomplete \
    python3-rosdep \
 && rosdep init && rosdep update \
 && rm -rf /var/lib/apt/lists/*

# ---------- miniconda + env 'my' (Python 3.8 — must match FoundationPose.py path) ----------
SHELL ["/bin/bash", "--login", "-c"]
RUN wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /miniconda.sh \
 && /bin/bash /miniconda.sh -b -p /opt/conda && rm /miniconda.sh \
 && /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main \
 && /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r \
 && /opt/conda/bin/conda create -y -n my python=3.8 \
 && /opt/conda/bin/conda clean -afy
ENV PATH=/opt/conda/envs/my/bin:/opt/conda/bin:$PATH

# ---------- Python deps in env 'my' (from NVlabs/FoundationPose dockerfile) ----------
RUN /opt/conda/bin/conda run -n my pip install --no-cache-dir \
      torch==2.0.0+cu118 torchvision==0.15.1+cu118 torchaudio==2.0.1 \
      --index-url https://download.pytorch.org/whl/cu118

RUN /opt/conda/bin/conda run -n my pip install --no-cache-dir \
      "git+https://github.com/facebookresearch/pytorch3d.git@stable"

RUN /opt/conda/bin/conda run -n my pip install --no-cache-dir \
      scipy joblib scikit-learn ruamel.yaml trimesh pyyaml \
      opencv-python opencv-contrib-python imageio open3d transformations \
      warp-lang einops kornia pyrender \
      ultralytics==8.0.120 \
      scikit-image meshcat webdataset omegaconf pypng roma seaborn \
      openpyxl imgaug Ninja xlsxwriter timm albumentations \
      xatlas rtree videoio numba pycocotools

# ---------- kaolin + nvdiffrast (CUDA extensions) ----------
# kaolin: pin v0.15.0 (PyTorch 1.6.0 - 2.1.1). v0.16+ 부터 PyTorch 2.3+ 요구하여
# 상류 NVlabs Dockerfile의 `git clone` 방식이 시간이 지나며 깨짐.
RUN cd /opt && git clone --recursive --branch v0.15.0 --depth 1 \
      https://github.com/NVIDIAGameWorks/kaolin \
 && cd kaolin && /opt/conda/bin/conda run -n my bash -c "FORCE_CUDA=1 python setup.py develop"

# nvdiffrast: pin v0.3.1 (안정 릴리스, 2023-01)
# 설치 직후 ops.py에서 TORCH_CUDA_ARCH_LIST=''로 강제 초기화하는 라인 주석 처리.
# 이 라인이 남아있으면 호스트 GPU arch를 PyTorch가 자동감지(RTX 40xx → compute_89)
# 하는데 CUDA 11.3 nvcc가 이를 지원하지 않아 JIT 빌드가 실패함.
RUN cd /opt && git clone --branch v0.3.1 --depth 1 https://github.com/NVlabs/nvdiffrast \
 && cd nvdiffrast && /opt/conda/bin/conda run -n my pip install --no-cache-dir . \
 && sed -i "s|os\.environ\['TORCH_CUDA_ARCH_LIST'\] = ''|# os.environ['TORCH_CUDA_ARCH_LIST'] = '' # patched: honor outer env|" \
      /opt/conda/envs/my/lib/python3.8/site-packages/nvdiffrast/torch/ops.py \
 && grep -n "TORCH_CUDA_ARCH_LIST" /opt/conda/envs/my/lib/python3.8/site-packages/nvdiffrast/torch/ops.py

# Additional FoundationPose runtime deps (상류 requirements.txt 중 estimater / learning
# 모듈 체인이 실제로 import 하는 항목. late layer 로 추가하여 kaolin·nvdiffrast 캐시 보존).
RUN /opt/conda/bin/conda run -n my pip install --no-cache-dir \
      h5py pysdf fvcore Panda3D GPUtil py-spy pybullet torchnet \
      colorama bokeh plotly simplejson PyOpenGL-accelerate

# TORCH_CUDA_ARCH_LIST="8.6+PTX":
#   CUDA 11.3 nvcc는 compute_89(RTX 40xx, Ada Lovelace)를 모름.
#   런타임에 nvdiffrast가 PyTorch cpp_extension으로 JIT 빌드하는데, 이 때
#   8.6로 PTX 빌드해 두고 드라이버(현 580/CUDA 13)가 SM 8.9로 JIT 재컴파일.
#   RTX 30xx 이하 GPU라면 이 변수 제거하거나 7.5/8.0 등으로 맞춰도 됨.
ENV TORCH_CUDA_ARCH_LIST="8.6+PTX"

# ---------- colcon workspace ----------
WORKDIR /ros2_ws
RUN mkdir -p /ros2_ws/src
COPY . /ros2_ws/src/zium_detection/

# Vendored FoundationPose-main은 weights·demo_data·estimater.py만 포함.
# estimater가 의존하는 Utils.py·datareader.py·learning/·offscreen_renderer.py 등은
# 상류 NVlabs/FoundationPose에서 overlay (cp -rn: 기존 파일은 보존).
RUN cd /tmp && git clone --depth 1 https://github.com/NVlabs/FoundationPose.git FP-upstream \
 && cp -rn FP-upstream/. /ros2_ws/src/zium_detection/FoundationPose-main/ \
 && rm -rf FP-upstream

RUN bash -c "source /opt/ros/foxy/setup.bash && cd /ros2_ws && colcon build --symlink-install"

# ---------- entrypoint: source ROS + overlay, then exec CMD ----------
COPY docker/ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh

ENTRYPOINT ["/ros_entrypoint.sh"]
CMD ["ros2", "launch", "zium_detection", "detection.launch.py"]
