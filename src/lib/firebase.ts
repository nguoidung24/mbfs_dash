import { initializeApp } from 'firebase/app';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  sessionUser?: string | null;
}

export function getActiveSessionUsername(): string | null {
  try {
    const raw = sessionStorage.getItem('dama2_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: string };
    return parsed.username || null;
  } catch {
    return null;
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    sessionUser: getActiveSessionUsername(),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Không thể kết nối tới cơ sở dữ liệu Firestore dama2. Vui lòng kiểm tra cấu hình.');
      return false;
    }
    return true;
  }
}

testConnection();
