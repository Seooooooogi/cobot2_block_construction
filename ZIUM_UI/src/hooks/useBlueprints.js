/**
 * useBlueprints — 설계도를 Firestore에 저장/불러오기 (로컬 JSON 파일 대체)
 *
 * Firestore 구조:
 *   blueprints/{docId}
 *     name      : String
 *     savedAt   : Timestamp
 *     levels    : Array<number>
 *     blocks    : Array<BlockObject>
 *     ownerUid  : String (로그인 사용자 UID)
 */
import { useState, useCallback } from 'react';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { firestore } from '../firebase';

export function useBlueprints(user) {
  const [savedList, setSavedList] = useState([]);   // 저장된 설계도 목록
  const [isLoading, setIsLoading] = useState(false);

  // 현재 설계도를 Firestore에 저장
  const saveBlueprint = useCallback(async (name, levels, blocks) => {
    if (!user) {
      alert('⚠️ 로그인 후 저장할 수 있습니다.');
      return;
    }
    if (!blocks.length) {
      alert('저장할 블록 정보가 없습니다.');
      return;
    }
    setIsLoading(true);
    try {
      await addDoc(collection(firestore, 'blueprints'), {
        name: name || `설계도_${new Date().toLocaleString('ko-KR')}`,
        levels,
        blocks,
        ownerUid: user.uid,
        savedAt: serverTimestamp(),
      });
      alert('✅ Firestore에 저장되었습니다!');
    } catch (e) {
      alert('저장 실패: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // 내 설계도 목록 불러오기
  const fetchMyBlueprints = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const q = query(
        collection(firestore, 'blueprints'),
        where('ownerUid', '==', user.uid),
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // savedAt 기준 내림차순 정렬 (클라이언트)
      list.sort((a, b) => (b.savedAt?.seconds ?? 0) - (a.savedAt?.seconds ?? 0));
      setSavedList(list);
    } catch (e) {
      console.error('설계도 목록 조회 실패:', e);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  return { savedList, isLoading, saveBlueprint, fetchMyBlueprints };
}
