import { GRID_SIZE } from '../constants';

/**
 * BlockType id ↔ 로봇 전송용 타입 코드 매핑.
 *
 * pick2build 수신 측이 type 문자열로 매칭하므로 변경 시 다운스트림 contract가 깨진다.
 * 알 수 없는 typeId는 안전한 기본값 "1"로 폴백.
 *
 * @param {string} typeId - constants.js BlockType.id
 *                          (b1x2, b2x1, b2x2_v, b2x2_h, b2x3, b3x2 중 하나).
 * @returns {string} 1~6 사이의 문자열 타입 코드.
 */
export function getBlockTypeNumber(typeId) {
  const map = {
    'b1x2':   "1", // 1x2 세로
    'b2x1':   "2", // 2x1 가로
    'b2x2_v': "3", // 2x2 세로
    'b2x2_h': "4", // 2x2 가로
    'b2x3':   "5", // 2x3 세로
    'b3x2':   "6", // 3x2 가로
  };
  return map[typeId] || "1";
}

/**
 * 캔버스 블록 배열을 로봇 전송용 payload로 변환한다.
 *
 * 변환 단계:
 *   1. (level → y → x) 오름차순 정렬 — 로봇이 밑층부터, 같은 층 내에서는 위쪽부터 처리
 *   2. 픽셀 좌표를 격자 단위로 변환 (block.x / GRID_SIZE)
 *   3. 블록 중심 좌표 계산 (격자 단위, w/h의 절반 더함)
 *   4. 격자 → 로봇 좌표계 변환 (×2) — 캔버스 격자 한 칸이 로봇 좌표계 2단위
 *   5. 1부터 시작하는 robotId 부여 + idMap에 (block.id → robotId) 동기화
 *
 * 단일 층만 들어와도 정렬 함수의 level 비교는 항상 0이 되어 동작에 영향 없음
 * (publishToRobot 전체 / publishCurrentLevelToRobot 단일 층 두 경우 모두 정상).
 *
 * @param {Array<{
 *   id: number, x: number, y: number, w: number, h: number,
 *   level: number, typeId: string, help?: boolean
 * }>} blocks - placedBlocks 또는 부분집합. 캔버스 좌표(픽셀) 기준.
 *
 * @returns {{
 *   payload: Array<{
 *     id: number,
 *     type: string,
 *     level: number,
 *     help: boolean,
 *     coordinate: { x: number, y: number }
 *   }>,
 *   idMap: { [blockId: number]: number }
 * }}
 *   payload: /block/info 토픽 publish용 JSON 배열.
 *   idMap:   호출자가 placedBlocks의 robotId를 갱신할 때 사용 (UI 시각화용).
 */
export function buildPayload(blocks) {
  const sorted = [...blocks].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  const idMap = {};
  const payload = sorted.map((block, index) => {
    // 픽셀 → 격자 단위
    const gridX = block.x / GRID_SIZE;
    const gridY = block.y / GRID_SIZE;
    // 블록 중심 (격자 단위)
    const centerX = gridX + block.w / 2;
    const centerY = gridY + block.h / 2;
    // 격자 → 로봇 좌표계 (×2)
    const robotX = centerX * 2;
    const robotY = centerY * 2;

    const robotId = index + 1;
    idMap[block.id] = robotId;

    return {
      id: robotId,
      type: getBlockTypeNumber(block.typeId),
      level: block.level,
      help: !!block.help,
      coordinate: { x: robotX, y: robotY },
    };
  });

  return { payload, idMap };
}
