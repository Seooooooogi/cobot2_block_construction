import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Firebase 콘솔 (https://console.firebase.google.com) 에서 프로젝트 생성 후
// 아래 값을 교체하세요. 현재는 플레이스홀더 값입니다.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'YOUR_API_KEY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'YOUR_PROJECT.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'YOUR_PROJECT_ID',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'YOUR_PROJECT.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_SENDER_ID',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'YOUR_APP_ID',
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);       // Realtime Database — ROS 명령 브로커
export const firestore = getFirestore(app); // Firestore — 설계도 저장/불러오기
export const auth = getAuth(app);         // Authentication — Google 로그인
export const googleProvider = new GoogleAuthProvider();
