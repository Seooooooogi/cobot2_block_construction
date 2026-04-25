# ZIUM Detection — ROS 2 Humble + CUDA 11.8 + FoundationPose + YOLO
# 단일 PC 호스트(Humble) ↔ 컨테이너(Humble) 구조로 DDS 호환 문제 회피.
# CUDA 11.8 nvcc가 compute_89(Ada/RTX 40xx)를 네이티브 지원하므로 nvdiffrast 패치 불필요.
#
# Build:  scripts/build_detection_docker.sh  (권장 — mitigation 옵션 포함)
#         또는: docker build -t zium-detection:humble-cu118 -f Dockerfile .
# Run:    docker-compose.yml (--gpus all, --network=host)

FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

# MAX_JOBS=4, MAKEFLAGS=-j4: 노트북(Katana 17, RTX 4060) 빌드 freeze 완화.
# pybind11 make·pytorch3d setup·kaolin FORCE_CUDA nvcc·colcon이 모두 4 worker로 제한됨.
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Seoul \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    OPENCV_IO_ENABLE_OPENEXR=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=all \
    PYTHONUNBUFFERED=1 \
    MAX_JOBS=4 \
    MAKEFLAGS=-j4

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
 && make -j4 && make install

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
# upgrade pip (pin setuptools<81: 구버전 패키지들이 pkg_resources에 의존)
RUN python3 -m pip install --no-cache-dir --upgrade pip "setuptools<81" wheel

# PyTorch 2.0.1+cu118 (py3.10 지원)
RUN python3 -m pip install --no-cache-dir \
    torch==2.0.1+cu118 torchvision==0.15.2+cu118 torchaudio==2.0.2 \
    --index-url https://download.pytorch.org/whl/cu118

# blinker는 Ubuntu 22.04 base의 python3-blinker (distutils-installed)가 pip uninstall 불가 →
# 별도 라인에서 --ignore-installed로 처리. (--ignore-installed는 글로벌 플래그라 같은 라인의
# 다른 패키지 의존성까지 모두 재해결시키므로 분리 필수.)
RUN python3 -m pip install --no-cache-dir --ignore-installed blinker

# FoundationPose core runtime deps (ultralytics 제외 — 아래 별도 라인 참조)
# numpy==1.24.4 핀: kaolin v0.15.0의 .eggs Cython 0.29가 numpy>=1.25의 'noexcept nogil' pxd
# 문법(Cython 3.x 전용)을 못 컴파일 → setup develop 단계에서 빌드 실패. 1.24.4 고정으로 회피.
RUN python3 -m pip install --no-cache-dir \
    "numpy==1.24.4" \
    scipy joblib scikit-learn ruamel.yaml trimesh pyyaml \
    opencv-python opencv-contrib-python imageio open3d transformations \
    warp-lang einops kornia pyrender \
    scikit-image meshcat webdataset omegaconf pypng roma seaborn \
    openpyxl imgaug Ninja xlsxwriter timm albumentations \
    xatlas rtree videoio numba pycocotools \
    h5py pysdf fvcore Panda3D GPUtil py-spy pybullet \
    colorama bokeh plotly simplejson PyOpenGL-accelerate

# pytorch3d (heavy, separate layer for cache)
# --no-build-isolation: pytorch3d setup.py가 torch를 require하는데 pip의 격리 환경엔 미설치
RUN python3 -m pip install --no-cache-dir --no-build-isolation \
    "git+https://github.com/facebookresearch/pytorch3d.git@stable"

# torch 재고정 — 이전 단계 transitive deps가 torch를 덮어쓴 경우 cu118로 복구.
# --force-reinstall --no-deps: torch/vision/audio만 강제 재설치, deps는 그대로 유지.
RUN python3 -m pip install --no-cache-dir --force-reinstall --no-deps \
    torch==2.0.1+cu118 torchvision==0.15.2+cu118 torchaudio==2.0.2 \
    --index-url https://download.pytorch.org/whl/cu118

# ---------- kaolin + nvdiffrast (CUDA extensions) ----------
# kaolin v0.15.0은 원래 py3.8 기준. py3.10 빌드는 IGNORE_TORCH_VER 및 기타 플래그 없이 시도 후,
# 실패 시 태그 업그레이드 필요 (README 주석 참고).
#
# `python setup.py develop` 회피: 최신 setuptools가 이를 `pip install -e . --use-pep517`로
# 리다이렉트 → isolated build env에 setuptools≥81 설치 → pkg_resources 제거 →
# kaolin/setup.py:12 `from pkg_resources import parse_version` ImportError.
# `pip install --no-build-isolation --no-deps -e .` 직접 호출로 host setuptools(<81) 사용.
RUN cd /opt && git clone --recursive --branch v0.15.0 --depth 1 \
      https://github.com/NVIDIAGameWorks/kaolin \
 && cd kaolin && FORCE_CUDA=1 \
    python3 -m pip install --no-build-isolation --no-deps -e .

# nvdiffrast v0.3.1
# --no-build-isolation: setuptools<81 host 환경 사용 (kaolin과 동일 회피).
# --no-deps: torch 등 deps 재해결 차단 (cu13 회귀 방지).
RUN cd /opt && git clone --branch v0.3.1 --depth 1 https://github.com/NVlabs/nvdiffrast \
 && cd nvdiffrast && python3 -m pip install --no-cache-dir --no-build-isolation --no-deps .

# ---------- ultralytics (YOLO) — 끝쪽에 배치: 버전 변경해도 위 heavy compile layer 캐시 보존 ----------
# YOLOv11 (8.3+) 추가 런타임 deps — 8.0.120 시기엔 없던 패키지.
RUN python3 -m pip install --no-cache-dir py-cpuinfo ultralytics-thop

# ultralytics — --no-deps로 torch>=1.8.0 deps 재해결 차단.
# 미차단 시 PyPI 기본 인덱스에서 torch 2.11.0+cu130 + cuda-toolkit 13.x 끌어옴 → cu118 환경 붕괴.
# 8.3.0: best.pt가 YOLOv11(C3k2) 구조로 학습됨 → 8.3.0+ 필요 (8.0.120은 C3k2 미지원).
# 필요 런타임 deps(numpy, opencv, pillow, pyyaml, torch, torchvision, scipy, matplotlib, tqdm,
# requests, pandas, seaborn, psutil, py-cpuinfo, ultralytics-thop)는 위 RUN들에서 이미 설치됨.
RUN python3 -m pip install --no-cache-dir --no-deps ultralytics==8.3.0

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

# --symlink-install 제거: setuptools≥80에서 `setup.py develop --editable` 옵션이 deprecated/제거되어
# colcon build가 zium_detection 빌드 시 거부됨. 컨테이너 내부는 정적 install로 충분.
RUN bash -c "source /opt/ros/humble/setup.bash && cd /ros2_ws && colcon build --parallel-workers 2"

# ---------- entrypoint: source ROS + overlay, then exec CMD ----------
COPY docker/ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh

ENTRYPOINT ["/ros_entrypoint.sh"]
CMD ["ros2", "launch", "zium_detection", "detection.launch.py"]
