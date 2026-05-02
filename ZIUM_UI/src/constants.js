/**
 * 전역 상수 모음.
 *
 * App.jsx와 hooks/ 모듈이 공통으로 참조하는 캔버스·블록·ROS 통신 상수를 모아둔다.
 * 값 변경 시 영향 범위가 넓으므로 단일 출처(SoT)로 유지한다.
 */

/**
 * 블록 타입 정의 목록.
 *
 * 사이드바의 드래그 가능한 블록과 캔버스에 배치된 블록의 외형·크기를 결정한다.
 * 각 항목은 BlockType 형태를 따른다.
 *
 * @typedef {Object} BlockType
 * @property {string} id    - 블록 식별자 (b1x2, b2x1, b2x2_v, b2x2_h, b2x3, b3x2).
 *                            이 값은 utils/blockType.js의 getBlockTypeNumber()에서
 *                            로봇 전송용 숫자 문자열("1"~"6")로 매핑된다.
 *                            매핑이 어긋나면 pick2build 수신 측 type 매칭이 실패한다.
 * @property {string} label - UI 표시 라벨 (한국어).
 * @property {number} w     - 가로 격자 칸 수 (1~3).
 * @property {number} h     - 세로 격자 칸 수 (1~3).
 * @property {string} color - 배경 색상 (CSS hex). 캔버스에 그려지는 placed-block의 backgroundColor.
 *
 * @type {BlockType[]}
 */
export const BLOCK_TYPES = [
  { id: 'b1x2',   label: '1 X 2 (세로)', w: 1, h: 2, color: '#9b59b6' },
  { id: 'b2x1',   label: '2 X 1 (가로)', w: 2, h: 1, color: '#3498db' },
  { id: 'b2x2_v', label: '2 X 2 (세로)', w: 2, h: 2, color: '#f1c40f' },
  { id: 'b2x2_h', label: '2 X 2 (가로)', w: 2, h: 2, color: '#f39c12' },
  { id: 'b2x3',   label: '2 X 3 (세로)', w: 2, h: 3, color: '#e67e22' },
  { id: 'b3x2',   label: '3 X 2 (가로)', w: 3, h: 2, color: '#e74c3c' },
];

/**
 * 캔버스 가로 크기 (px).
 * 격자 40칸 × GRID_SIZE(50) = 2000. 로봇 좌표계 X축은 0~80 (격자 단위 × 2).
 */
export const CANVAS_W = 2000;

/**
 * 캔버스 세로 크기 (px).
 * 격자 24칸 × GRID_SIZE(50) = 1200. 로봇 좌표계 Y축은 0~48 (격자 단위 × 2).
 */
export const CANVAS_H = 1200;

/**
 * 격자 한 칸 크기 (px).
 * 블록 좌표 스냅·충돌 검사·드래그 프리뷰 위치 계산의 기본 단위.
 */
export const GRID_SIZE = 50;

/**
 * rosbridge WebSocket 접속 URL.
 *
 * 브라우저가 호스팅된 Vite dev 서버와 같은 호스트의 9090 포트로 접속한다.
 * (예: 브라우저가 192.168.1.250:5173에서 열렸다면 ws://192.168.1.250:9090)
 *
 * 호스트 분리(예: UI 별도 PC) 운용 시 환경변수화 검토 대상.
 */
export const ROS_BRIDGE_URL = `ws://${window.location.hostname}:9090`;

/**
 * 블록 설계도 일괄 전송 토픽 이름.
 * UI → pick2build (호스트). std_msgs/String 메시지에 JSON 배열을 담아 publish한다.
 */
export const CMD_TOPIC_NAME = '/block/info';
