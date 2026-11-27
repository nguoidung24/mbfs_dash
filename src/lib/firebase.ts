import { getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);
const provisionerApp =
  getApps().find((a) => a.name === 'userProvisioner') ||
  initializeApp(firebaseConfig, 'userProvisioner');

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const provisionerAuth = getAuth(provisionerApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const DAMA2_SUPER_ADMIN_EMAIL = 'dungtamtithoi24@gmail.com';
export const FIXED_SPACE_ID = 'DAMA2';
export const DEFAULT_ADMIN_UID = 'usr_mbfs_admin';
export const SYSTEM_CONFIG_DOC_ID = 'department';

// Clean up any legacy raw-config or multi-space localStorage entries
try {
  localStorage.removeItem('dama2_active_space_v1');
  localStorage.removeItem('dama2_active_db_config_v1');
  localStorage.removeItem('dama2_saved_db_configs_v1');
} catch {
  // ignore
}

export function getActiveSpaceId(): string {
  return FIXED_SPACE_ID;
}

export function getDefaultAdminUid(): string {
  return DEFAULT_ADMIN_UID;
}

export function getSystemConfigDocId(): string {
  return SYSTEM_CONFIG_DOC_ID;
}

export function getInternalAuthEmail(username: string): string {
  const cleanUser = username.trim().toLowerCase();
  return `${cleanUser}@dama2.app`;
}

export function isInternalAuthEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.trim().toLowerCase().endsWith('@dama2.app'));
}

export function maskEmail(email: string | null | undefined): string {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) return '***';
  const [local, domain] = clean.split('@');
  if (!domain) return '***';
  const maskedLocal =
    local.length <= 2
      ? `${local[0] || '*'}***`
      : local.length <= 4
      ? `${local.slice(0, 1)}***${local.slice(-1)}`
      : `${local.slice(0, 2)}***${local.slice(-2)}`;
  return `${maskedLocal}@${domain}`;
}

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
    if (auth.currentUser?.email) {
      return auth.currentUser.email;
    }
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
