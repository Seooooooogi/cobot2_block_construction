# ZIUM Detection — ROS 2 Humble + CUDA 11.8 + FoundationPose + YOLO
# 단일 PC 호스트(Humble) ↔ 컨테이너(Humble) 구조로 DDS 호환 문제 회피.
# CUDA 11.8 nvcc가 compute_89(Ada/RTX 40xx)를 네이티브 지원하므로 nvdiffrast 패치 불필요.
#
# Build:  docker build -t zium-detection:humble-cu118 -f Dockerfile .
# Run:    docker-compose.yml (--gpus all, --network=host)

FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Seoul \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    OPENCV_IO_ENABLE_OPENEXR=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=all \
    PYTHONUNBUFFERED=1

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ---------- system deps (+ OpenGL libs since cudagl base is EOL) ----------
RUN apt-get update --fix-missing && apt-get install -y --no-install-recommends \
    build-essential cmake g++ gcc gfortran pkg-config git wget curl ca-certificates \
    bzip2 vim tmux locales software-properties-common gnupg2 lsb-release \
    python3 python3-pip python3-dev python3-venv \
    libgtk2.0-dev libjpeg-dev libtiff-dev yasm \
    libavcodec-dev libavformat-dev libswscale-dev libdc1394-dev \
    libxine2-dev libv4l-dev libtbb-dev libatlas-base-dev \
    libhdf5-dev libboost-all-dev libyaml-cpp-dev libflann-dev \
    freeglut3-dev libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender1 \
    libegl1 libopengl0 libxkbcommon0 \
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

# ---------- ROS 2 Humble ----------
RUN add-apt-repository universe \
 && curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(lsb_release -cs) main" > /etc/apt/sources.list.d/ros2.list \
 && apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-ros-base \
    ros-humble-cv-bridge \
    ros-humble-tf2-msgs \
    ros-humble-tf2-ros \
    ros-humble-rmw-fastrtps-cpp \
    python3-colcon-common-extensions \
    python3-argcomplete \
    python3-rosdep \
 && rosdep init && rosdep update \
 && rm -rf /var/lib/apt/lists/*

# ---------- Python 3.10 ML/CV stack ----------
# upgrade pip first to avoid resolver issues
RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel

# PyTorch 2.0.1+cu118 (py3.10 지원)
RUN python3 -m pip install --no-cache-dir \
    torch==2.0.1+cu118 torchvision==0.15.2+cu118 torchaudio==2.0.2 \
    --index-url https://download.pytorch.org/whl/cu118

# FoundationPose core runtime deps
RUN python3 -m pip install --no-cache-dir \
    scipy joblib scikit-learn ruamel.yaml trimesh pyyaml \
    opencv-python opencv-contrib-python imageio open3d transformations \
    warp-lang einops kornia pyrender \
    ultralytics==8.0.120 \
    scikit-image meshcat webdataset omegaconf pypng roma seaborn \
    openpyxl imgaug Ninja xlsxwriter timm albumentations \
    xatlas rtree videoio numba pycocotools \
    h5py pysdf fvcore Panda3D GPUtil py-spy pybullet torchnet \
    colorama bokeh plotly simplejson PyOpenGL-accelerate

# pytorch3d (heavy, separate layer for cache)
RUN python3 -m pip install --no-cache-dir \
    "git+https://github.com/facebookresearch/pytorch3d.git@stable"

# ---------- kaolin + nvdiffrast (CUDA extensions) ----------
# kaolin v0.15.0은 원래 py3.8 기준. py3.10 빌드는 IGNORE_TORCH_VER 및 기타 플래그 없이 시도 후,
# 실패 시 태그 업그레이드 필요 (README 주석 참고).
RUN cd /opt && git clone --recursive --branch v0.15.0 --depth 1 \
      https://github.com/NVIDIAGameWorks/kaolin \
 && cd kaolin && FORCE_CUDA=1 python3 setup.py develop

# nvdiffrast v0.3.1
RUN cd /opt && git clone --branch v0.3.1 --depth 1 https://github.com/NVlabs/nvdiffrast \
 && cd nvdiffrast && python3 -m pip install --no-cache-dir .

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

RUN bash -c "source /opt/ros/humble/setup.bash && cd /ros2_ws && colcon build --symlink-install"

# ---------- entrypoint: source ROS + overlay, then exec CMD ----------
COPY docker/ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh

ENTRYPOINT ["/ros_entrypoint.sh"]
CMD ["ros2", "launch", "zium_detection", "detection.launch.py"]
