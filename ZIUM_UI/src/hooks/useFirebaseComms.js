/**
 * useFirebaseComms — rosbridge를 Firebase Realtime Database로 교체한 통신 훅
 *
 * RTDB 구조:
 *   /jium/
 *     commands/
 *       block_info      : 설계도 JSON (UI → Control PC)
 *       signal_stop     : Int (1 = 정지 요청)
 *       signal_start    : Int (1 = 재개 요청)
 *       signal_unlock   : Int (1 = 강제재개 요청)
 *     status/
 *       completed_id    : Int (Control PC → UI, 배치 완료된 블록 ID)
 *       robot_state     : String (Control PC → UI)
 *
 * Control PC 측에서는 별도 Python Firebase 리스너가 RTDB를 감시하고
 * 변경 감지 시 ROS 토픽으로 변환합니다. (ZIUM_Control/firebase_bridge.py 참조)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { ref, set, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';

export function useFirebaseComms({ onBlockCompleted }) {
  const [connectionStatus, setConnectionStatus] = useState('연결 안됨 ⚪');
  const connectedRef = useRef(null);

  // Firebase RTDB 연결 상태 감시 (.info/connected)
  useEffect(() => {
    setConnectionStatus('연결 시도 중... 🟡');
    const connRef = ref(db, '.info/connected');
    connectedRef.current = onValue(connRef, (snap) => {
      if (snap.val() === true) {
        setConnectionStatus('연결 완료 🟢');
      } else {
        setConnectionStatus('연결 끊김 ⚪');
      }
    });

    return () => {
      if (connectedRef.current) connectedRef.current();
    };
  }, []);

  // Control PC가 완료 신호를 RTDB에 쓰면 UI가 감지
  useEffect(() => {
    const completedRef = ref(db, 'jium/status/completed_id');
    const unsub = onValue(completedRef, (snap) => {
      const id = snap.val();
      if (id !== null && id !== undefined) {
        onBlockCompleted(id);
      }
    });
    return () => unsub();
  }, [onBlockCompleted]);

  // 설계도 데이터를 RTDB에 기록 (rosbridge publish 대체)
  const publishBlueprint = useCallback(async (payloadData) => {
    await set(ref(db, 'jium/commands/block_info'), {
      data: JSON.stringify(payloadData),
      sentAt: serverTimestamp(),
    });
  }, []);

  // 제어 신호 발행 (stop / start / unlock)
  const publishSignal = useCallback(async (signalName) => {
    // signalName: 'signal_stop' | 'signal_start' | 'signal_unlock'
    await set(ref(db, `jium/commands/${signalName}`), {
      data: 1,
      sentAt: serverTimestamp(),
    });
  }, []);

  return { connectionStatus, publishBlueprint, publishSignal };
}
