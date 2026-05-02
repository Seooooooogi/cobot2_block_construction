#!/usr/bin/env bash
# download_foundationpose_weights.sh — NVlabs FoundationPose pretrained weights 다운로드
#
# 다운로드 항목:
#   - Refiner: weights/2023-10-28-18-33-37/  (model_best.pth ~68M + config.yml)
#   - Scorer:  weights/2024-01-11-20-02-45/  (model_best.pth ~190M + config.yml)
#
# 출처:
#   https://drive.google.com/drive/folders/1DFezOAD0oD1BblsXVxqDsl8fj0qzB82i
#
# Drive 폴더 구조에 `no_diffusion/` 서브가 있어 코드 기대 경로와 다름.
# 다운로드 후 weights/ 직속으로 이동하는 단계를 포함.
#
# 미포함 (사용자가 별도 제공):
#   - weights/best.pt              (커스텀 YOLO 학습 결과)
#   - weights/T_gripper2camera.npy (그리퍼↔카메라 외부 보정)
#   - demo_data/lego/mesh/         (LEGO 3D 메시)
#
# 사용:
#   ./scripts/download_foundationpose_weights.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEIGHTS_DIR="${REPO_ROOT}/ZIUM_Detection/FoundationPose-main/weights"
DRIVE_FOLDER_URL="https://drive.google.com/drive/folders/1DFezOAD0oD1BblsXVxqDsl8fj0qzB82i"

REFINER_DIR="${WEIGHTS_DIR}/2023-10-28-18-33-37"
SCORER_DIR="${WEIGHTS_DIR}/2024-01-11-20-02-45"

# ---------- gdown 가용성 확인 ----------
GDOWN_BIN=""
if command -v gdown >/dev/null 2>&1; then
  GDOWN_BIN="gdown"
elif [[ -x "${HOME}/.local/bin/gdown" ]]; then
  GDOWN_BIN="${HOME}/.local/bin/gdown"
else
  echo "[weights] gdown 미설치 — 사용자 site-packages에 설치"
  python3 -m pip install --user gdown
  GDOWN_BIN="${HOME}/.local/bin/gdown"
fi
echo "[weights] gdown: ${GDOWN_BIN}"

# ---------- 멱등성 체크 ----------
if [[ -f "${REFINER_DIR}/model_best.pth" && -f "${REFINER_DIR}/config.yml" \
   && -f "${SCORER_DIR}/model_best.pth"  && -f "${SCORER_DIR}/config.yml" ]]; then
  echo "[weights] 이미 존재함 — skip"
  echo "  Refiner: ${REFINER_DIR}"
  echo "  Scorer:  ${SCORER_DIR}"
  exit 0
fi

mkdir -p "${WEIGHTS_DIR}"
cd "${WEIGHTS_DIR}"

echo "[weights] 다운로드 중 (Refiner ~68M + Scorer ~190M)..."
"${GDOWN_BIN}" --folder "${DRIVE_FOLDER_URL}"

# ---------- no_diffusion/ 서브폴더 정리 ----------
# Drive 폴더 구조: weights/no_diffusion/{2023-...,2024-...}
# 코드 기대 경로:  weights/{2023-...,2024-...}
if [[ -d "${WEIGHTS_DIR}/no_diffusion" ]]; then
  echo "[weights] no_diffusion/ 서브폴더 정리"
  shopt -s nullglob
  for d in "${WEIGHTS_DIR}/no_diffusion/"*/; do
    target="${WEIGHTS_DIR}/$(basename "${d}")"
    if [[ -d "${target}" ]]; then
      echo "  skip: ${target} 이미 존재"
    else
      mv "${d}" "${WEIGHTS_DIR}/"
      echo "  moved: $(basename "${d}")"
    fi
  done
  shopt -u nullglob
  rmdir "${WEIGHTS_DIR}/no_diffusion" 2>/dev/null || true
fi

# ---------- 검증 ----------
MISSING=()
[[ -f "${REFINER_DIR}/model_best.pth" ]] || MISSING+=("${REFINER_DIR}/model_best.pth")
[[ -f "${REFINER_DIR}/config.yml"     ]] || MISSING+=("${REFINER_DIR}/config.yml")
[[ -f "${SCORER_DIR}/model_best.pth"  ]] || MISSING+=("${SCORER_DIR}/model_best.pth")
[[ -f "${SCORER_DIR}/config.yml"      ]] || MISSING+=("${SCORER_DIR}/config.yml")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo
  echo "[weights] ERROR: 다음 파일이 누락됨:" >&2
  for f in "${MISSING[@]}"; do echo "  - ${f}" >&2; done
  echo
  echo "수동 다운로드: ${DRIVE_FOLDER_URL}" >&2
  exit 1
fi

echo
echo "[weights] 완료:"
ls -la "${REFINER_DIR}" "${SCORER_DIR}"
