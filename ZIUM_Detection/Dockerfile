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
RUN cd /opt && git clone --recursive https://github.com/NVIDIAGameWorks/kaolin \
 && cd kaolin && /opt/conda/bin/conda run -n my bash -c "FORCE_CUDA=1 python setup.py develop"

RUN cd /opt && git clone https://github.com/NVlabs/nvdiffrast \
 && cd nvdiffrast && /opt/conda/bin/conda run -n my pip install --no-cache-dir .

# ---------- colcon workspace ----------
WORKDIR /ros2_ws
RUN mkdir -p /ros2_ws/src
COPY . /ros2_ws/src/zium_detection/

RUN bash -c "source /opt/ros/foxy/setup.bash && cd /ros2_ws && colcon build --symlink-install"

# ---------- entrypoint: source ROS + overlay, then exec CMD ----------
COPY docker/ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh

ENTRYPOINT ["/ros_entrypoint.sh"]
CMD ["ros2", "launch", "zium_detection", "detection.launch.py"]
