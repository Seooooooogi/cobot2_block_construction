import { useEffect, useRef, useState } from 'react';
import { ROS_BRIDGE_URL, CMD_TOPIC_NAME } from '../constants';
import { buildPayload } from '../utils/blockPayload';

/**
 * useROS — rosbridge WebSocket 연결 + 토픽/서비스 호출 hook.
 *
 * 컴포넌트 마운트 시 ROS_BRIDGE_URL로 자동 연결하고, 언마운트 시 연결을 닫는다.
 * 연결 상태는 rosStatus 문자열로 노출되어 헤더 카드에서 시각화된다.
 *
 * ROSLIB은 index.html의 CDN 스크립트로 전역(`window.ROSLIB`)에 로드되므로
 * import 문 없이 직접 참조한다 (npm 패키지 형태로 사용하지 않음).
 *
 * 외부 의존(setter):
 *   - 연결 직후 /signal_id 토픽 구독 → setCompletedBlockIds로 누적
 *   - publishBlockInfo 성공 시 진행률 카운터 / 로봇 상태 카드 갱신
 *   - callSignalService 응답 시 robotWorkingStatus 전이
 *
 * @param {Object}   params
 * @param {Function} params.setCompletedBlockIds  - /signal_id 메시지로부터 완료 ID 누적.
 *                                                   같은 ID 재수신은 무시.
 * @param {Function} params.setTotalSentCount     - publishBlockInfo 시 전송 개수 갱신.
 * @param {Function} params.setRobotWorkingStatus - publishBlockInfo 시 '건설중 🏗️',
 *                                                   stop/start 응답 시 일시정지/재개 등 전이.
 *
 * @returns {{
 *   rosRef:            React.MutableRefObject,
 *   rosStatus:         string,
 *   callSignalService: (serviceName: string) => void,
 *   publishBlockInfo:  (blocks: Array) => ({ idMap: Object, payload: Array } | null)
 * }}
 */
export function useROS({
  setCompletedBlockIds,
  setTotalSentCount,
  setRobotWorkingStatus,
}) {
  const rosRef = useRef(null);
  const [rosStatus, setRosStatus] = useState('연결 안됨 ⚪');

  /**
   * rosbridge WebSocket 연결 시도.
   *
   * 성공 시 /signal_id 토픽 구독을 자동 등록한다 — 로봇이 블록 배치를 완료할 때마다
   * Int32 형태의 robotId를 발행한다. 같은 ID 중복 수신은 무시 (배열에 새 ID만 append).
   *
   * 연결 상태 문자열 규약:
   *   '연결 안됨 ⚪'    : 초기값
   *   '연결 시도 중... 🟡' : 연결 시작
   *   '연결 완료 🟢'    : ROS .on('connection')
   *   '연결 에러 🔴'    : ROS .on('error')
   *   '연결 끊김 ⚪'    : ROS .on('close')
   *   '초기화 에러 🔴'  : ROSLIB.Ros 생성 자체가 throw한 경우
   */
  const connectROS = () => {
    setRosStatus('연결 시도 중... 🟡');
    try {
      const ros = new ROSLIB.Ros({ url: ROS_BRIDGE_URL });
      ros.on('connection', () => {
        setRosStatus('연결 완료 🟢');
        rosRef.current = ros;

        // /signal_id 구독: 로봇 → UI, 블록 배치 완료 ID 진행률 stream
        const signalIdTopic = new ROSLIB.Topic({
          ros,
          name: '/signal_id',
          messageType: 'std_msgs/msg/Int32',
        });

        signalIdTopic.subscribe((message) => {
          console.log('[로봇 완료 응답] 놓은 블록 ID:', message.data);
          // 같은 ID 중복 수신은 무시
          setCompletedBlockIds((prev) =>
            prev.includes(message.data) ? prev : [...prev, message.data]
          );
        });
      });
      ros.on('error', () => setRosStatus('연결 에러 🔴'));
      ros.on('close', () => setRosStatus('연결 끊김 ⚪'));
    } catch (e) {
      setRosStatus('초기화 에러 🔴');
    }
  };

  // 마운트 시 자동 연결, 언마운트 시 해제
  useEffect(() => {
    connectROS();
    return () => {
      if (rosRef.current) rosRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 제어 명령(Stop/Start/Unlock) ROS Service 호출.
   *
   * 응답 success === true 시 robotWorkingStatus를 전이:
   *   /signal_stop   → '일시 정지 ⏸️'
   *   /signal_start  → '재개 🔄' → 1.5초 후 '진행 중 🏗️' (UX: 잠깐의 전환 메시지 노출)
   *   /signal_unlock → 상태 전이 없음 (콘솔 ack만)
   *
   * 연결 미상태 시 alert 후 무시. 응답 success === false면 message를 alert에 띄움.
   *
   * @param {string} serviceName - '/signal_stop' | '/signal_start' | '/signal_unlock'.
   */
  const callSignalService = (serviceName) => {
    if (!rosRef.current || !rosRef.current.isConnected) {
      alert("⚠️ 로봇(ROS)에 연결되어 있지 않습니다!");
      return;
    }

    const signalService = new ROSLIB.Service({
      ros: rosRef.current,
      name: serviceName,
      serviceType: 'std_srvs/srv/Trigger',
    });

    const request = new ROSLIB.ServiceRequest({});
    signalService.callService(
      request,
      (result) => {
        console.log(`[제어 명령 응답] 서비스: ${serviceName}, success: ${result.success}, message: ${result.message}`);

        if (!result.success) {
          alert(`⚠️ 제어 명령 실패: ${result.message}`);
          return;
        }

        if (serviceName === '/signal_stop') {
          setRobotWorkingStatus('일시 정지 ⏸️');
        } else if (serviceName === '/signal_start') {
          setRobotWorkingStatus('재개 🔄');
          setTimeout(() => setRobotWorkingStatus('진행 중 🏗️'), 1500);
        }
      },
      (error) => {
        console.error(`[제어 명령 에러] 서비스: ${serviceName}, error: ${error}`);
        alert(`⚠️ 제어 명령 호출 실패: ${error}`);
      }
    );
  };

  /**
   * 블록 배열을 payload로 변환 + /block/info 토픽으로 publish.
   *
   * 호출 측(publishToRobot/publishCurrentLevelToRobot)에서 빈 배열 가드와
   * placedBlocks.robotId 갱신/alert 메시지 처리를 담당하므로, 이 함수는
   * "ROS 연결 가드 + buildPayload + publish + 진행률/상태 갱신"만 책임진다.
   *
   * Side effects (성공 시):
   *   - setTotalSentCount(payload.length)
   *   - setCompletedBlockIds([]) — 진행률 초기화
   *   - setRobotWorkingStatus('건설중 🏗️')
   *   - console.log("Publishing Target Data:", jsonString) — payload 비교 디버깅용
   *
   * @param {Array} blocks - placedBlocks 또는 그 부분집합.
   *                         정렬은 buildPayload 내부에서 (level, y, x) 오름차순.
   *
   * @returns {{ idMap: Object, payload: Array } | null}
   *   성공: idMap (호출자가 placedBlocks의 robotId 갱신에 사용) + payload
   *   실패: null (연결 안 됨, alert 표시됨)
   */
  const publishBlockInfo = (blocks) => {
    if (!rosRef.current || !rosRef.current.isConnected) {
      alert("⚠️ 로봇(ROS)에 연결되어 있지 않습니다!");
      return null;
    }

    const { payload, idMap } = buildPayload(blocks);

    setTotalSentCount(payload.length);
    setCompletedBlockIds([]);
    setRobotWorkingStatus('건설중 🏗️');

    const cmdTopic = new ROSLIB.Topic({
      ros: rosRef.current,
      name: CMD_TOPIC_NAME,
      messageType: 'std_msgs/String',
    });

    const jsonString = JSON.stringify(payload);
    console.log("Publishing Target Data:", jsonString);
    cmdTopic.publish({ data: jsonString });

    return { payload, idMap };
  };

  return { rosRef, rosStatus, callSignalService, publishBlockInfo };
}
