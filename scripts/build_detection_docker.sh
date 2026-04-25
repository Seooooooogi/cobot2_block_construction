#!/usr/bin/env bash
# build_detection_docker.sh — ZIUM_Detection Docker 이미지 빌드 (mitigation 포함)
#
# 적용된 freeze 완화책:
#   1. --progress=plain    : 모든 stdout/stderr 라이브 출력 (buildkit 요약 차단 방지)
#   2. --memory=20g        : 컨테이너 빌드 RAM 한도 (호스트 31Gi 중)
#   3. --memory-swap=20g   : swap 사용 차단 (= memory와 동일값)
#   4. tee build.log       : 다음 freeze 대비 영속 기록
#   5. Dockerfile 측: MAX_JOBS=4, MAKEFLAGS=-j4, colcon --parallel-workers 2
#
# 사용:
#   ./scripts/build_detection_docker.sh           # 캐시 사용
#   ./scripts/build_detection_docker.sh --no-cache # 클린 빌드
#
# 빌드 중 다른 셸에서 모니터링 권장:
#   watch -n 2 'sensors | grep -E "Package|Composite"; nvidia-smi --query-gpu=temperature.gpu,power.draw,memory.used --format=csv'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DETECTION_DIR="${REPO_ROOT}/ZIUM_Detection"
IMAGE_TAG="zium-detection:humble-cu118"
LOG_FILE="${DETECTION_DIR}/build.log"

if [[ ! -f "${DETECTION_DIR}/Dockerfile" ]]; then
  echo "ERROR: Dockerfile not found at ${DETECTION_DIR}/Dockerfile" >&2
  exit 1
fi

EXTRA_ARGS=()
if [[ "${1:-}" == "--no-cache" ]]; then
  EXTRA_ARGS+=(--no-cache)
  echo "[build] --no-cache 적용 (클린 빌드)"
fi

cd "${DETECTION_DIR}"

echo "[build] image: ${IMAGE_TAG}"
echo "[build] log:   ${LOG_FILE}"
echo "[build] freeze 발생 시 build.log에 마지막 출력 라인 보존됨"
echo

DOCKER_BUILDKIT=1 docker build \
  --progress=plain \
  --memory=20g \
  --memory-swap=20g \
  "${EXTRA_ARGS[@]}" \
  -t "${IMAGE_TAG}" \
  -f Dockerfile \
  . 2>&1 | tee "${LOG_FILE}"

echo
echo "[build] 완료: ${IMAGE_TAG}"
echo "[run] 다음: docker compose up   (ZIUM_Detection/docker-compose.yml)"
