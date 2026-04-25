#!/usr/bin/env bash
# Create the 'foundationpose' conda env and install CUDA-11.8 builds of
# torch, pytorch3d, kaolin, nvdiffrast, and FoundationPose runtime deps.
#
# Prereqs (run first):
#   ./scripts/setup_foundationpose_host.sh
#
# Idempotent — safe to re-run. Stops on first error.
#
# Usage:
#   ./scripts/setup_foundationpose_env.sh

set -euo pipefail

ENV_NAME="foundationpose"
PY_VER="3.10"
CONDA_ROOT="${HOME}/miniconda3"
DEPS_DIR="${HOME}/fp_deps"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FP_MAIN_DIR="${PROJECT_ROOT}/ZIUM_Detection/FoundationPose-main"
FP_UPSTREAM_URL="https://github.com/NVlabs/FoundationPose.git"
KAOLIN_URL="https://github.com/NVIDIAGameWorks/kaolin"
KAOLIN_TAG="v0.15.0"
NVDIFFRAST_URL="https://github.com/NVlabs/nvdiffrast"
NVDIFFRAST_TAG="v0.3.1"

log() { printf '\n\033[1;34m[env]\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

# ---------- preflight ----------
preflight() {
  [[ -x "${CONDA_ROOT}/bin/conda" ]] || { echo "[fail] conda 없음 — setup_foundationpose_host.sh 먼저 실행" >&2; exit 1; }
  command -v nvcc >/dev/null || { echo "[fail] nvcc 없음 — 새 셸에서 source ~/.bashrc 후 재실행" >&2; exit 1; }
  nvcc --version | grep -q "release 11.8" || { echo "[fail] nvcc가 11.8이 아님" >&2; exit 1; }
  ok "preflight 통과 (conda + nvcc 11.8)"
}

# ---------- system runtime libs (apt) ----------
install_system_runtime() {
  local needed=(
    libgl1-mesa-glx libegl1 libopengl0 libxkbcommon0
    libglib2.0-0 libsm6 libxext6 libxrender1
    libosmesa6-dev freeglut3-dev
  )
  local missing=()
  for pkg in "${needed[@]}"; do
    dpkg -s "${pkg}" &>/dev/null || missing+=("${pkg}")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "system 런타임 라이브러리 모두 설치됨"
    return
  fi
  log "누락 apt 패키지 설치: ${missing[*]}"
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends "${missing[@]}"
}

# ---------- conda env ----------
accept_conda_tos() {
  # conda 26+는 비대화식 create 전에 채널 TOS 수락 필요.
  local channels=(
    "https://repo.anaconda.com/pkgs/main"
    "https://repo.anaconda.com/pkgs/r"
  )
  for ch in "${channels[@]}"; do
    "${CONDA_ROOT}/bin/conda" tos accept --override-channels --channel "${ch}" >/dev/null 2>&1 || true
  done
  ok "conda TOS 수락 완료"
}

create_env() {
  # shellcheck disable=SC1091
  source "${CONDA_ROOT}/etc/profile.d/conda.sh"
  if "${CONDA_ROOT}/bin/conda" env list | awk '{print $1}' | grep -qx "${ENV_NAME}"; then
    ok "conda env '${ENV_NAME}' 이미 존재"
  else
    log "conda create -n ${ENV_NAME} python=${PY_VER}"
    "${CONDA_ROOT}/bin/conda" create -y -n "${ENV_NAME}" "python=${PY_VER}"
  fi
  conda activate "${ENV_NAME}"
  ok "activated: $(python --version)"
}

# ---------- pip deps (in env) ----------
pip_install_core() {
  log "pip + setuptools<81 + wheel"
  python -m pip install --no-cache-dir --upgrade pip "setuptools<81" wheel

  # numpy를 먼저 고정 설치: 뒤이어 오는 패키지들이 이 numpy를 존중하게 함.
  # 1.24.4 고정 이유: kaolin 0.15.0이 Cython 0.29.20을 .eggs에 강제 설치하는데,
  # numpy 1.25+ pxd는 'noexcept nogil' 문법(Cython 3.x 전용) 사용 → 0.29로 컴파일 실패.
  log "numpy==1.24.4 선설치 (kaolin Cython 0.29 호환)"
  python -m pip install --no-cache-dir "numpy==1.24.4"

  log "torch 2.0.1+cu118 stack (pytorch.org 인덱스)"
  python -m pip install --no-cache-dir \
    torch==2.0.1+cu118 torchvision==0.15.2+cu118 torchaudio==2.0.2 \
    --index-url https://download.pytorch.org/whl/cu118

  # 버전 가드: 다음 단계에서 torch가 덮어써지면 pytorch3d/kaolin 빌드가 망가짐.
  local tver
  tver=$(python -c "import torch; print(torch.__version__)")
  if [[ "${tver}" != "2.0.1+cu118" ]]; then
    echo "[fail] torch version ${tver} (expected 2.0.1+cu118)" >&2
    exit 1
  fi
  ok "torch ${tver} 고정"

  # --ignore-installed 제거: 위에서 설치한 torch/numpy를 덮어쓰지 않도록.
  log "FoundationPose runtime deps"
  python -m pip install --no-cache-dir \
    scipy joblib scikit-learn ruamel.yaml trimesh pyyaml \
    opencv-python opencv-contrib-python imageio open3d transformations \
    warp-lang einops kornia pyrender \
    ultralytics==8.0.120 \
    scikit-image meshcat webdataset omegaconf pypng roma seaborn \
    openpyxl imgaug Ninja xlsxwriter timm albumentations \
    xatlas rtree videoio numba pycocotools \
    h5py pysdf fvcore Panda3D GPUtil py-spy pybullet \
    colorama bokeh plotly simplejson PyOpenGL-accelerate

  # 재검증: ultralytics가 torch를 끌어올리지 않았는지.
  tver=$(python -c "import torch; print(torch.__version__)")
  if [[ "${tver}" != "2.0.1+cu118" ]]; then
    echo "[fail] runtime deps 설치 후 torch가 ${tver}로 바뀜. 재생성 필요." >&2
    exit 1
  fi
  ok "torch 버전 유지: ${tver}"

  # numpy 재고정: runtime deps 설치 중 open3d/scikit-image/numba 등이 numpy>=2 제약으로 업그레이드함.
  # --no-deps로 주변 패키지 건드리지 않고 numpy만 되돌림.
  local nver
  nver=$(python -c "import numpy; print(numpy.__version__)")
  if [[ "${nver}" != "1.24.4" ]]; then
    log "numpy가 ${nver}로 변경됨 → 1.24.4로 강제 재고정 (--no-deps)"
    python -m pip install --no-cache-dir --force-reinstall --no-deps "numpy==1.24.4"
    nver=$(python -c "import numpy; print(numpy.__version__)")
  fi
  [[ "${nver}" == "1.24.4" ]] || { echo "[fail] numpy 재고정 실패: ${nver}" >&2; exit 1; }
  ok "numpy ${nver} 확정"
}

pip_install_pytorch3d() {
  if python -c "import pytorch3d" &>/dev/null; then
    ok "pytorch3d 이미 설치됨"
    return
  fi
  log "pytorch3d (stable, --no-build-isolation)"
  python -m pip install --no-cache-dir --no-build-isolation \
    "git+https://github.com/facebookresearch/pytorch3d.git@stable"
}

# ---------- kaolin (CUDA ext, develop install) ----------
install_kaolin() {
  if python -c "import kaolin" &>/dev/null; then
    ok "kaolin 이미 설치됨"
    return
  fi
  mkdir -p "${DEPS_DIR}"
  local src="${DEPS_DIR}/kaolin"
  if [[ ! -d "${src}/.git" ]]; then
    log "kaolin ${KAOLIN_TAG} clone → ${src}"
    git clone --recursive --branch "${KAOLIN_TAG}" --depth 1 "${KAOLIN_URL}" "${src}"
  fi
  # 이전 실패 빌드 흔적 제거 (재시도 시 깨끗한 상태 보장).
  log "kaolin 빌드 아티팩트 정리"
  ( cd "${src}" && rm -rf .eggs build dist kaolin.egg-info )
  # 빌드 직전 numpy 버전 가드: Cython 0.29는 numpy 1.25+ pxd 컴파일 실패.
  local nver
  nver=$(python -c "import numpy; print(numpy.__version__)")
  if [[ "${nver}" != "1.24.4" ]]; then
    echo "[fail] kaolin 빌드 전 numpy가 ${nver} (1.24.4 필요)" >&2
    exit 1
  fi
  log "kaolin 빌드 (FORCE_CUDA=1, 시간 소요)"
  # 'python setup.py develop'은 최신 setuptools에서 pip --use-pep517로 리다이렉트되고,
  # 그 isolated build env는 최신 setuptools(81+)를 쓰므로 pkg_resources 제거로 실패.
  # --no-build-isolation로 main env의 setuptools<81을 그대로 사용해 회피.
  # --no-deps: kaolin이 요구하는 numpy/scipy/torch가 이미 고정돼 있어 재해결 방지.
  ( cd "${src}" && FORCE_CUDA=1 python -m pip install --no-build-isolation --no-deps -e . )

  # kaolin __init__은 io·viz 모듈까지 top-level에서 import하므로
  # tools/{requirements,viz_requirements}.txt의 core·viz deps를 모두 필요로 함.
  # pygltflib/dataclasses_json는 하위 의존성이 있어 --no-deps 없이 설치.
  log "kaolin core 보조 의존성 (pygltflib+dataclasses_json, pybind11)"
  python -m pip install --no-cache-dir pygltflib dataclasses_json pybind11

  log "kaolin viz 보조 의존성 (ipycanvas, ipyevents, jupyter_client, comm)"
  python -m pip install --no-cache-dir ipycanvas ipyevents jupyter_client "comm>=0.1.3"

  # pyzmq<25 강제: kaolin 제약. 현재 27.x가 설치돼 있을 경우 downgrade.
  log "pyzmq<25 고정 (kaolin 제약)"
  python -m pip install --no-cache-dir --force-reinstall --no-deps "pyzmq<25"

  # 보조 deps 설치가 numpy를 업그레이드했을 수 있음 → 재고정.
  local nver
  nver=$(python -c "import numpy; print(numpy.__version__)")
  if [[ "${nver}" != "1.24.4" ]]; then
    log "numpy가 ${nver}로 변경됨 → 1.24.4로 재고정"
    python -m pip install --no-cache-dir --force-reinstall --no-deps "numpy==1.24.4"
  fi

  python -c "import kaolin; print('kaolin', kaolin.__version__)"
}

# ---------- nvdiffrast ----------
install_nvdiffrast() {
  if python -c "import nvdiffrast" &>/dev/null; then
    ok "nvdiffrast 이미 설치됨"
    return
  fi
  mkdir -p "${DEPS_DIR}"
  local src="${DEPS_DIR}/nvdiffrast"
  if [[ ! -d "${src}/.git" ]]; then
    log "nvdiffrast ${NVDIFFRAST_TAG} clone → ${src}"
    git clone --branch "${NVDIFFRAST_TAG}" --depth 1 "${NVDIFFRAST_URL}" "${src}"
  fi
  log "nvdiffrast pip install"
  python -m pip install --no-cache-dir "${src}"
  python -c "import nvdiffrast; print('nvdiffrast OK')"
}

# ---------- FoundationPose upstream overlay ----------
overlay_foundationpose_upstream() {
  # Vendored FoundationPose-main은 weights·demo_data·estimater.py만 포함.
  # Utils.py·datareader.py·learning/ 등은 상류 NVlabs/FoundationPose에서 overlay (no-clobber).
  if [[ -f "${FP_MAIN_DIR}/Utils.py" ]]; then
    ok "FoundationPose upstream overlay 이미 적용됨"
    return
  fi
  [[ -d "${FP_MAIN_DIR}" ]] || { echo "[fail] ${FP_MAIN_DIR} 없음" >&2; exit 1; }
  local tmp
  tmp="$(mktemp -d)"
  log "FoundationPose upstream clone → 오버레이 (기존 vendored 파일 보존)"
  git clone --depth 1 "${FP_UPSTREAM_URL}" "${tmp}/FP-upstream"
  cp -rn "${tmp}/FP-upstream/." "${FP_MAIN_DIR}/"
  rm -rf "${tmp}"
  ok "overlay 완료"
}

# ---------- verify ----------
verify_env() {
  log "import 검증"
  python - <<'PY'
import sys, importlib
mods = ["torch","torchvision","numpy","scipy","cv2","open3d",
        "pytorch3d","kaolin","nvdiffrast","trimesh","ultralytics"]
for m in mods:
    importlib.import_module(m)
    print(f"  {m}: OK")
import torch
print(f"  torch.cuda.is_available={torch.cuda.is_available()}")
print(f"  torch.version.cuda={torch.version.cuda}")
print(f"  torch.cuda.get_device_name(0)={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A'}")
PY
}

main() {
  preflight
  install_system_runtime
  accept_conda_tos
  create_env
  pip_install_core
  pip_install_pytorch3d
  install_kaolin
  install_nvdiffrast
  overlay_foundationpose_upstream
  verify_env

  log "완료. 다음 단계:"
  echo "    conda activate ${ENV_NAME}"
  echo "    cd ${PROJECT_ROOT}/ZIUM_Detection && colcon build --symlink-install"
  echo "    source install/setup.bash"
  echo "    ros2 launch zium_detection detection.launch.py"
}

main "$@"
