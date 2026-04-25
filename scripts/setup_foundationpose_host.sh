#!/usr/bin/env bash
# Host setup for FoundationPose on single-PC JIUM (Ubuntu 22.04 + ROS 2 Humble).
# Installs CUDA Toolkit 11.8 (no driver change) and Miniconda.
# Idempotent — safe to re-run. Stops on first error.
#
# Usage:
#   chmod +x scripts/setup_foundationpose_host.sh
#   ./scripts/setup_foundationpose_host.sh

set -euo pipefail

CUDA_VER="11.8"
CUDA_TAG="11-8"
CUDA_HOME_PATH="/usr/local/cuda-${CUDA_VER}"
CONDA_DIR="${HOME}/miniconda3"
CUDA_KEYRING_URL="https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb"
MINICONDA_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"

log() { printf '\n\033[1;34m[setup]\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

require_os() {
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
    echo "[fail] expected Ubuntu 22.04, got ${ID:-?} ${VERSION_ID:-?}" >&2
    exit 1
  fi
  ok "Ubuntu 22.04 확인"
}

require_driver() {
  if ! command -v nvidia-smi >/dev/null; then
    echo "[fail] nvidia-smi 없음 — NVIDIA driver 먼저 설치 필요" >&2
    exit 1
  fi
  local drv
  drv=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1)
  ok "NVIDIA driver ${drv} 감지"
}

install_cuda_toolkit() {
  if command -v nvcc >/dev/null && nvcc --version | grep -q "release ${CUDA_VER}"; then
    ok "CUDA Toolkit ${CUDA_VER} 이미 설치됨 — 건너뜀"
    return
  fi

  log "CUDA keyring 추가"
  local deb="/tmp/cuda-keyring_1.1-1_all.deb"
  wget -qO "${deb}" "${CUDA_KEYRING_URL}"
  sudo dpkg -i "${deb}"

  log "apt update 및 cuda-toolkit-${CUDA_TAG} 설치 (driver 패키지 제외)"
  sudo apt-get update
  # IMPORTANT: `cuda-toolkit-11-8`만 설치. `cuda` 메타패키지는 driver를 덮어쓰므로 금지.
  sudo apt-get install -y "cuda-toolkit-${CUDA_TAG}"
  ok "cuda-toolkit-${CUDA_TAG} 설치 완료"
}

configure_cuda_env() {
  local rc="${HOME}/.bashrc"
  local marker="# >>> cuda-${CUDA_VER} >>>"
  if grep -qF "${marker}" "${rc}"; then
    ok "CUDA PATH 이미 ~/.bashrc에 등록됨"
    return
  fi
  log "CUDA PATH를 ~/.bashrc에 추가"
  {
    echo ""
    echo "${marker}"
    echo "export PATH=${CUDA_HOME_PATH}/bin:\$PATH"
    echo "export LD_LIBRARY_PATH=${CUDA_HOME_PATH}/lib64:\${LD_LIBRARY_PATH:-}"
    echo "# <<< cuda-${CUDA_VER} <<<"
  } >> "${rc}"
  ok "CUDA env 등록 완료 (새 셸에서 nvcc 사용 가능)"
}

verify_cuda() {
  export PATH="${CUDA_HOME_PATH}/bin:${PATH}"
  if ! command -v nvcc >/dev/null; then
    echo "[fail] nvcc를 PATH에서 찾지 못함" >&2
    exit 1
  fi
  local ver
  ver=$(nvcc --version | grep -oP 'release \K[0-9]+\.[0-9]+')
  if [[ "${ver}" != "${CUDA_VER}" ]]; then
    echo "[fail] nvcc release ${ver} (expected ${CUDA_VER})" >&2
    exit 1
  fi
  ok "nvcc release ${ver} 확인"
}

install_miniconda() {
  if [[ -x "${CONDA_DIR}/bin/conda" ]]; then
    ok "Miniconda 이미 ${CONDA_DIR}에 설치됨 — 건너뜀"
    return
  fi
  log "Miniconda 설치 → ${CONDA_DIR}"
  local inst="/tmp/miniconda.sh"
  wget -qO "${inst}" "${MINICONDA_URL}"
  bash "${inst}" -b -p "${CONDA_DIR}"
  ok "Miniconda 설치 완료"
}

configure_conda() {
  if grep -q "conda initialize" "${HOME}/.bashrc"; then
    ok "conda init 이미 적용됨"
    return
  fi
  log "conda init bash"
  "${CONDA_DIR}/bin/conda" init bash
  ok "conda init 완료"
}

verify_conda() {
  local ver
  ver=$("${CONDA_DIR}/bin/conda" --version)
  ok "${ver}"
}

main() {
  require_os
  require_driver
  install_cuda_toolkit
  configure_cuda_env
  verify_cuda
  install_miniconda
  configure_conda
  verify_conda

  log "모두 완료. 새 셸을 열거나 다음 명령으로 env 반영:"
  echo "    source ~/.bashrc"
  echo ""
  echo "확인:"
  echo "    nvcc --version   # release 11.8"
  echo "    conda --version  # conda 24.x"
}

main "$@"
