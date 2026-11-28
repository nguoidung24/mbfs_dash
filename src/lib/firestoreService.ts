import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  WriteBatch,
} from 'firebase/firestore';
import {
  AuthBinding,
  DEFAULT_ADMIN_USERNAME,
  EncryptedAccountPayload,
  Project,
  ProjectStatus,
  RoleCode,
  ReviewResult,
  SubmissionStatus,
  SystemConfig,
  TaskItem,
  TaskPriority,
  TaskStatus,
  UserProfile,
  WorkGroup,
} from '../types/domain';
import {
  DEFAULT_ADMIN_BOOTSTRAP_HASH,
  decryptJsonPayload,
  encryptJsonPayload,
  generateSpaceAesKeyBase64,
  importSpaceAesKey,
  validatePasswordStrength,
  verifyPassword,
} from './cryptoAuth';
import {
  auth,
  db,
  getActiveSpaceId,
  getDefaultAdminUid,
  getInternalAuthEmail,
  getSystemConfigDocId,
  googleProvider,
  handleFirestoreError,
  isInternalAuthEmail,
  OperationType,
  provisionerAuth,
} from './firebase';
import { buildParticipantIds, canManageProjectMembers } from './rbac';
import { dateStrToNum, getVietnamNowParts } from './time';

const SESSION_STORAGE_KEY = 'dama2_session';
const spaceKeyCache = new Map<string, CryptoKey>();

export interface StoredSession {
  userId: string;
  username: string;
  spaceId?: string;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsernameFormat(username: string): boolean {
  return (
    username.length >= 2 &&
    username.length <= 64 &&
    /^[a-z0-9._-]+$/.test(username)
  );
}

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

const VALID_ROLE_CODES: RoleCode[] = [
  'ADMIN',
  'TRUONG_PHONG',
  'PHO_PHONG',
  'QUAN_LY_DU_AN',
  'TRUONG_NHOM',
  'CHUYEN_VIEN',
];

function sanitizeRolesList(roles: unknown): RoleCode[] {
  if (!Array.isArray(roles)) return ['CHUYEN_VIEN'];
  const filtered = Array.from(
    new Set(roles.filter((r): r is RoleCode => VALID_ROLE_CODES.includes(r as RoleCode)))
  ).slice(0, 6);
  return filtered.length > 0 ? filtered : ['CHUYEN_VIEN'];
}

function isFirestoreTimestampValue(value: unknown): value is Timestamp {
  if (value instanceof Timestamp) return true;
  if (typeof value === 'object' && value !== null) {
    const obj = value as { seconds?: unknown; nanoseconds?: unknown };
    return typeof obj.seconds === 'number' && typeof obj.nanoseconds === 'number';
  }
  return false;
}

async function upsertAuthBinding(params: {
  authUid: string;
  userId: string;
  departmentId: string;
  isActive: boolean;
}): Promise<void> {
  const bindingRef = doc(db, 'authBindings', params.authUid);
  const bindingSnap = await getDocFromServer(bindingRef);
  if (bindingSnap.exists()) {
    const bData = bindingSnap.data() as Record<string, unknown>;
    await updateDoc(bindingRef, {
      userId: params.userId,
      isActive: params.isActive,
      ...(isFirestoreTimestampValue(bData?.createdAt) ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(bindingRef, {
      authUid: params.authUid,
      userId: params.userId,
      departmentId: params.departmentId,
      isActive: params.isActive,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export function clearSpaceKeyCache(spaceId?: string): void {
  if (spaceId) {
    spaceKeyCache.delete(spaceId);
  } else {
    spaceKeyCache.clear();
  }
}

export async function getSpaceAesKey(
  spaceId: string = getActiveSpaceId()
): Promise<CryptoKey | null> {
  const cached = spaceKeyCache.get(spaceId);
  if (cached) return cached;
  try {
    const snap = await getDocFromServer(doc(db, 'spaceKeys', spaceId));
    if (!snap.exists()) return null;
    const data = snap.data() as { keyBase64?: string };
    if (!data.keyBase64) return null;
    const key = await importSpaceAesKey(data.keyBase64);
    spaceKeyCache.set(spaceId, key);
    return key;
  } catch {
    return null;
  }
}

export async function getOrInitSpaceAesKey(
  spaceId: string = getActiveSpaceId()
): Promise<CryptoKey> {
  const existing = await getSpaceAesKey(spaceId);
  if (existing) return existing;

  const keyBase64 = await generateSpaceAesKeyBase64();
  await setDoc(doc(db, 'spaceKeys', spaceId), {
    spaceId,
    keyBase64,
    alg: 'AES-256-GCM',
    createdAt: serverTimestamp(),
  });
  const key = await importSpaceAesKey(keyBase64);
  spaceKeyCache.set(spaceId, key);
  return key;
}

export async function encryptAccountData(
  key: CryptoKey,
  payload: EncryptedAccountPayload
): Promise<string> {
  return encryptJsonPayload(key, payload);
}

export async function encryptPrivateData(
  key: CryptoKey,
  pii: { email: string }
): Promise<string> {
  return encryptJsonPayload(key, pii);
}

export async function decryptPrivateEmail(
  raw: Record<string, unknown>,
  spaceKey: CryptoKey | null
): Promise<string> {
  if (typeof raw.encryptedPrivate === 'string' && spaceKey) {
    const dec = await decryptJsonPayload<{ email?: string }>(
      spaceKey,
      raw.encryptedPrivate
    );
    if (dec && typeof dec.email === 'string') {
      return dec.email;
    }
  }
  return typeof raw.email === 'string' ? raw.email : '';
}

export async function decodeUserProfileDoc(
  raw: Record<string, unknown>,
  spaceKey: CryptoKey | null
): Promise<UserProfile> {
  let payload: EncryptedAccountPayload | null = null;
  if (typeof raw.encryptedAccount === 'string' && spaceKey) {
    payload = await decryptJsonPayload<EncryptedAccountPayload>(
      spaceKey,
      raw.encryptedAccount
    );
  }
  const uid = String(raw.uid || '');
  return {
    uid,
    authUid: typeof raw.authUid === 'string' ? raw.authUid : undefined,
    encryptedAccount:
      typeof raw.encryptedAccount === 'string' ? raw.encryptedAccount : undefined,
    mustChangePassword:
      typeof raw.mustChangePassword === 'boolean' ? raw.mustChangePassword : false,
    username: payload?.username || (typeof raw.username === 'string' ? raw.username : ''),
    employeeCode:
      payload?.employeeCode ||
      (typeof raw.employeeCode === 'string' ? raw.employeeCode : uid.slice(0, 10)),
    fullName:
      payload?.fullName ||
      (typeof raw.fullName === 'string' ? raw.fullName : 'Nhân sự'),
    title: payload?.title ?? (typeof raw.title === 'string' ? raw.title : ''),
    email: payload?.email ?? (typeof raw.email === 'string' ? raw.email : ''),
    roles: Array.isArray(raw.roles) ? (raw.roles as RoleCode[]) : ['CHUYEN_VIEN'],
    groupId: typeof raw.groupId === 'string' ? raw.groupId : '',
    managerId: typeof raw.managerId === 'string' ? raw.managerId : '',
    isActive: typeof raw.isActive === 'boolean' ? raw.isActive : true,
    departmentId:
      typeof raw.departmentId === 'string' ? raw.departmentId : getActiveSpaceId(),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function decodeUserProfiles(
  rawList: Array<Record<string, unknown>>,
  spaceId: string = getActiveSpaceId()
): Promise<UserProfile[]> {
  const spaceKey = await getSpaceAesKey(spaceId);
  return Promise.all(rawList.map((r) => decodeUserProfileDoc(r, spaceKey)));
}

export function saveSession(session: StoredSession): void {
  sessionStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      ...session,
      spaceId: session.spaceId || getActiveSpaceId(),
    })
  );
}

export async function logoutSession(): Promise<void> {
  clearSpaceKeyCache();
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch {
    // ignore signOut errors
  }
}

export async function runBatchOps(
  ops: Array<(batch: WriteBatch) => void>,
  chunkSize: number = 400
): Promise<void> {
  const safeChunk = Math.max(1, Math.min(400, chunkSize));
  for (let i = 0; i < ops.length; i += safeChunk) {
    const chunk = ops.slice(i, i + safeChunk);
    const batch = writeBatch(db);
    for (const op of chunk) {
      op(batch);
    }
    await batch.commit();
  }
}

export async function restoreCurrentSession(): Promise<{
  user: UserProfile;
  mustChangePassword: boolean;
} | null> {
  try {
    await auth.authStateReady();
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    if (!isInternalAuthEmail(firebaseUser.email)) {
      await signOut(auth);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    const spaceId = getActiveSpaceId();
    const bindingSnap = await getDocFromServer(doc(db, 'authBindings', firebaseUser.uid));
    if (!bindingSnap.exists()) {
      await logoutSession();
      return null;
    }

    const binding = bindingSnap.data() as AuthBinding;
    if (!binding.isActive || binding.departmentId !== spaceId) {
      await logoutSession();
      return null;
    }

    const [userSnap, spaceKey] = await Promise.all([
      getDocFromServer(doc(db, 'users', binding.userId)),
      getSpaceAesKey(spaceId),
    ]);

    if (!userSnap.exists()) {
      await logoutSession();
      return null;
    }

    const rawUser = userSnap.data() as Record<string, unknown>;
    if (!rawUser.isActive) {
      await logoutSession();
      return null;
    }

    const user = await decodeUserProfileDoc(rawUser, spaceKey);
    saveSession({
      userId: user.uid,
      username: user.username || '',
      spaceId,
    });

    return {
      user,
      mustChangePassword: Boolean(rawUser.mustChangePassword),
    };
  } catch {
    await logoutSession();
    return null;
  }
}

function getAuthErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code?: unknown }).code || '');
  }
  return '';
}

export async function loginWithUsernamePassword(
  usernameInput: string,
  password: string
): Promise<{
  user: UserProfile;
  mustChangePassword: boolean;
}> {
  const username = normalizeUsername(usernameInput);
  if (!isValidUsernameFormat(username) || !password) {
    throw new Error('Tên đăng nhập hoặc mật khẩu không hợp lệ.');
  }

  const spaceId = getActiveSpaceId();
  const internalEmail = getInternalAuthEmail(username);

  let signedInViaBootstrap = false;
  try {
    await signInWithEmailAndPassword(auth, internalEmail, password);
  } catch (err) {
    const code = getAuthErrorCode(err);
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Phương thức Email/Password chưa được bật trong Firebase Authentication. Vui lòng bật Email/Password tại Firebase Console → Authentication → Sign-in method.'
      );
    }
    if (code === 'auth/too-many-requests') {
      throw new Error(
        'Bạn đã nhập sai mật khẩu quá nhiều lần. Firebase Authentication tạm khóa đăng nhập trong ít phút.'
      );
    }
    if (code === 'auth/user-disabled') {
      throw new Error('Tài khoản xác thực đã bị vô hiệu hóa.');
    }

    if (
      (code === 'auth/user-not-found' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password') &&
      username === DEFAULT_ADMIN_USERNAME
    ) {
      const matchesBootstrap = await verifyPassword(
        password,
        DEFAULT_ADMIN_BOOTSTRAP_HASH
      );
      if (!matchesBootstrap) {
        throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
      }

      try {
        await createUserWithEmailAndPassword(auth, internalEmail, password);
        signedInViaBootstrap = true;
      } catch (createErr) {
        const createCode = getAuthErrorCode(createErr);
        if (createCode === 'auth/operation-not-allowed') {
          throw new Error(
            'Phương thức Email/Password chưa được bật trong Firebase Authentication. Vui lòng bật Email/Password tại Firebase Console → Authentication → Sign-in method.'
          );
        }
        if (createCode === 'auth/email-already-in-use') {
          throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
        }
        throw createErr;
      }
    } else {
      throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
    }
  }

  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    throw new Error('Không thể khởi tạo phiên xác thực Firebase.');
  }

  const authUid = firebaseUser.uid;
  const adminUid = getDefaultAdminUid();
  const cfgId = getSystemConfigDocId();

  if (signedInViaBootstrap) {
    try {
      const userRef = doc(db, 'users', adminUid);
      const existingAdminSnap = await getDocFromServer(userRef);
      const spaceKey = await getOrInitSpaceAesKey(spaceId);

      const existingRaw = existingAdminSnap.exists()
        ? (existingAdminSnap.data() as Record<string, unknown>)
        : null;

      const payload: EncryptedAccountPayload = {
        username: DEFAULT_ADMIN_USERNAME,
        employeeCode:
          existingRaw && typeof existingRaw.employeeCode === 'string' && existingRaw.employeeCode
            ? existingRaw.employeeCode
            : 'AD-01',
        fullName:
          existingRaw && typeof existingRaw.fullName === 'string' && existingRaw.fullName
            ? existingRaw.fullName
            : 'Quản trị hệ thống',
        title:
          existingRaw && typeof existingRaw.title === 'string' && existingRaw.title
            ? existingRaw.title
            : 'Quản trị hệ thống',
        email: existingRaw && typeof existingRaw.email === 'string' ? existingRaw.email : '',
      };
      const encryptedAccount = await encryptAccountData(spaceKey, payload);
      const roles: RoleCode[] =
        existingRaw && Array.isArray(existingRaw.roles) && existingRaw.roles.length > 0
          ? (existingRaw.roles as RoleCode[])
          : ['ADMIN'];
      const groupId =
        existingRaw && typeof existingRaw.groupId === 'string' ? existingRaw.groupId : '';
      const managerId =
        existingRaw && typeof existingRaw.managerId === 'string' ? existingRaw.managerId : '';

      await setDoc(userRef, {
        uid: adminUid,
        authUid,
        encryptedAccount,
        mustChangePassword: true,
        roles,
        groupId,
        managerId,
        isActive: true,
        departmentId: spaceId,
        createdAt: existingRaw?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'authBindings', authUid), {
        authUid,
        userId: adminUid,
        departmentId: spaceId,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const cfgRef = doc(db, 'systemConfigs', cfgId);
      const cfgSnap = await getDocFromServer(cfgRef);
      if (!cfgSnap.exists()) {
        await setDoc(cfgRef, {
          lockHour: 23,
          lockMinute: 59,
          reminderHour: 17,
          reminderMinute: 30,
          timezone: 'Asia/Ho_Chi_Minh',
          defaultLabels: [
            'Hành chính',
            'Báo cáo định kỳ',
            'Văn bản trình ký',
            'Kiểm tra nội bộ',
            'Khẩn',
          ],
          holidays: [],
          departmentId: spaceId,
          updatedBy: adminUid,
          updatedAt: serverTimestamp(),
        });
      }

      const adminProfile: UserProfile = {
        uid: adminUid,
        authUid,
        encryptedAccount,
        mustChangePassword: true,
        username: payload.username,
        employeeCode: payload.employeeCode,
        fullName: payload.fullName,
        title: payload.title,
        email: payload.email,
        roles,
        groupId,
        managerId,
        isActive: true,
        departmentId: spaceId,
      };
      saveSession({ userId: adminUid, username: payload.username, spaceId });
      return {
        user: adminProfile,
        mustChangePassword: true,
      };
    } catch (error) {
      await logoutSession();
      handleFirestoreError(error, OperationType.WRITE, `users/${adminUid}`);
    }
  }

  let bindingSnap;
  try {
    bindingSnap = await getDocFromServer(doc(db, 'authBindings', authUid));
  } catch (error) {
    await logoutSession();
    handleFirestoreError(error, OperationType.GET, `authBindings/${authUid}`);
  }

  // Recover binding if admin Auth account existed without authBindings doc
  if (!bindingSnap.exists() && username === DEFAULT_ADMIN_USERNAME) {
    try {
      const adminSnap = await getDocFromServer(doc(db, 'users', adminUid));
      if (adminSnap.exists() && adminSnap.data()?.authUid === authUid) {
        await setDoc(doc(db, 'authBindings', authUid), {
          authUid,
          userId: adminUid,
          departmentId: spaceId,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        bindingSnap = await getDocFromServer(doc(db, 'authBindings', authUid));
      }
    } catch {
      // fall through
    }
  }

  if (!bindingSnap.exists()) {
    await logoutSession();
    throw new Error(
      'Tài khoản chưa được liên kết với hồ sơ nhân sự trong hệ thống. Vui lòng liên hệ Quản trị hệ thống.'
    );
  }

  const binding = bindingSnap.data() as AuthBinding;
  if (binding.departmentId !== spaceId) {
    await logoutSession();
    throw new Error('Tài khoản không thuộc cơ sở dữ liệu hiện tại.');
  }
  if (!binding.isActive) {
    await logoutSession();
    throw new Error('Tài khoản đang bị tạm khóa. Vui lòng liên hệ Quản trị viên phòng ban.');
  }

  let userSnap;
  try {
    userSnap = await getDocFromServer(doc(db, 'users', binding.userId));
  } catch (error) {
    await logoutSession();
    handleFirestoreError(error, OperationType.GET, `users/${binding.userId}`);
  }

  if (!userSnap.exists()) {
    await logoutSession();
    throw new Error('Không tìm thấy hồ sơ nhân sự cho tài khoản này.');
  }

  const rawUser = userSnap.data() as Record<string, unknown>;
  if (!rawUser.isActive) {
    await logoutSession();
    throw new Error('Tài khoản nhân sự hiện đang bị khóa. Vui lòng liên hệ Quản trị viên.');
  }

  const spaceKey = await getSpaceAesKey(spaceId);
  const user = await decodeUserProfileDoc(rawUser, spaceKey);
  saveSession({ userId: user.uid, username: user.username || username, spaceId });

  return {
    user,
    mustChangePassword: Boolean(rawUser.mustChangePassword),
  };
}

export async function changeOwnPassword(params: {
  username?: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser || !firebaseUser.email || !isInternalAuthEmail(firebaseUser.email)) {
    throw new Error('Không xác định được phiên tài khoản Firebase Auth đang đăng nhập.');
  }
  if (!params.currentPassword) {
    throw new Error('Vui lòng nhập mật khẩu hiện tại.');
  }
  if (params.newPassword === params.currentPassword) {
    throw new Error('Mật khẩu mới phải khác mật khẩu hiện tại.');
  }
  const strengthError = validatePasswordStrength(params.newPassword);
  if (strengthError) {
    throw new Error(strengthError);
  }

  try {
    const credential = EmailAuthProvider.credential(
      firebaseUser.email,
      params.currentPassword
    );
    await reauthenticateWithCredential(firebaseUser, credential);
  } catch (err) {
    const code = getAuthErrorCode(err);
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new Error('Mật khẩu hiện tại không chính xác.');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau ít phút.');
    }
    throw new Error('Không thể xác thực mật khẩu hiện tại.');
  }

  await updatePassword(firebaseUser, params.newPassword);

  const bindingSnap = await getDocFromServer(doc(db, 'authBindings', firebaseUser.uid));
  if (bindingSnap.exists()) {
    const binding = bindingSnap.data() as AuthBinding;
    const userRef = doc(db, 'users', binding.userId);
    const userSnap = await getDocFromServer(userRef);
    if (userSnap.exists() && userSnap.data()?.mustChangePassword) {
      try {
        await updateDoc(userRef, {
          mustChangePassword: false,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${binding.userId}`);
      }
    }
  }
}

export async function logSystemAudit(params: {
  actor: UserProfile;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  allUsers: UserProfile[];
}): Promise<void> {
  const id = makeId('aud');
  const viewerIds = Array.from(
    new Set([
      params.actor.uid,
      ...params.allUsers
        .filter(
          (u) =>
            u.roles.includes('ADMIN') ||
            u.roles.includes('TRUONG_PHONG') ||
            u.roles.includes('PHO_PHONG')
        )
        .map((u) => u.uid),
    ])
  ).slice(0, 30);

  try {
    await setDoc(doc(db, 'auditLogs', id), {
      id,
      actorId: params.actor.uid,
      actorName: (params.actor.fullName || 'Nhân sự').trim().slice(0, 120) || 'Nhân sự',
      action: params.action.trim().slice(0, 80) || 'Thao tác',
      targetType: params.targetType.trim().slice(0, 40) || 'system',
      targetId: params.targetId.trim().slice(0, 128) || id,
      detail: params.detail.trim().slice(0, 1000) || '-',
      viewerIds,
      departmentId: getActiveSpaceId(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `auditLogs/${id}`);
  }
}

export async function logTaskAudit(params: {
  taskId: string;
  actor: UserProfile;
  action: string;
  detail: string;
  participantIds: string[];
}): Promise<void> {
  const id = makeId('taud');
  try {
    await setDoc(doc(db, 'tasks', params.taskId, 'auditLogs', id), {
      id,
      actorId: params.actor.uid,
      actorName: params.actor.fullName,
      action: params.action,
      detail: params.detail.slice(0, 1000),
      taskParticipantIds: params.participantIds.slice(0, 50),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${params.taskId}/auditLogs/${id}`);
  }
}

export async function createOrUpdateTask(params: {
  existingTask?: TaskItem;
  input: {
    title: string;
    description: string;
    projectId: string;
    groupId: string;
    assigneeIds: string[];
    reviewerId: string;
    priority: TaskPriority;
    startDate: string;
    dueDate: string;
    estimatedHours: number;
    labels: string[];
    attachments: string[];
  };
  actor: UserProfile;
  projects: Project[];
  allUsers: UserProfile[];
  existingTaskCount: number;
}): Promise<void> {
  const { input, actor, projects, allUsers, existingTaskCount, existingTask } = params;
  const selectedProject = input.projectId
    ? projects.find((p) => p.id === input.projectId) || null
    : null;

  if (existingTask) {
    const assigneeId = input.assigneeIds[0] || existingTask.assigneeId;
    const participantIds = buildParticipantIds({
      creatorId: existingTask.creatorId,
      assigneeId,
      reviewerId: input.reviewerId || existingTask.reviewerId,
      groupId: input.groupId,
      project: selectedProject,
      allUsers,
    });
    try {
      await updateDoc(doc(db, 'tasks', existingTask.id), {
        title: input.title.trim().slice(0, 200),
        description: input.description.trim().slice(0, 5000),
        projectId: input.projectId,
        groupId: input.groupId,
        assigneeId,
        reviewerId: input.reviewerId || existingTask.reviewerId,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate,
        estimatedHours: Number(input.estimatedHours) || 0,
        labels: input.labels.slice(0, 10),
        attachments: input.attachments.slice(0, 10),
        participantIds,
        updatedAt: serverTimestamp(),
      });
      await logTaskAudit({
        taskId: existingTask.id,
        actor,
        action: 'Cập nhật công việc',
        detail: `Cập nhật thông tin công việc "${input.title.trim()}"`,
        participantIds,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${existingTask.id}`);
    }
    return;
  }

  const prefix = selectedProject
    ? selectedProject.code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    : 'TX';
  let seq = existingTaskCount + 1;

  if (input.assigneeIds.length > 1) {
    const parentId = makeId('tsk');
    const parentCode = `${prefix}-${String(seq).padStart(2, '0')}`;
    seq += 1;

    const parentReviewer = input.reviewerId || actor.uid;
    const parentParticipants = buildParticipantIds({
      creatorId: actor.uid,
      assigneeId: input.assigneeIds[0],
      reviewerId: parentReviewer,
      groupId: input.groupId,
      project: selectedProject,
      allUsers,
    });
    const mergedParticipants = Array.from(
      new Set([...parentParticipants, ...input.assigneeIds])
    ).slice(0, 50);

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'tasks', parentId), {
        id: parentId,
        code: parentCode,
        title: input.title.trim().slice(0, 200),
        description: input.description.trim().slice(0, 5000),
        projectId: input.projectId,
        groupId: input.groupId,
        creatorId: actor.uid,
        assigneeId: actor.uid,
        reviewerId: parentReviewer,
        parentTaskId: '',
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate,
        estimatedHours: Number(input.estimatedHours) || 0,
        labels: input.labels.slice(0, 10),
        attachments: input.attachments.slice(0, 10),
        status: 'DANG_THUC_HIEN' as TaskStatus,
        submissionStatus: 'CHUA_NOP' as SubmissionStatus,
        submissionNote: '',
        reviewResult: 'CHO_XAC_NHAN' as ReviewResult,
        reviewNote: '',
        isLocked: false,
        participantIds: mergedParticipants,
        departmentId: getActiveSpaceId(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const assigneeId of input.assigneeIds) {
        const assigneeUser = allUsers.find((u) => u.uid === assigneeId);
        const childId = makeId('tsk');
        const childCode = `${prefix}-${String(seq).padStart(2, '0')}`;
        seq += 1;
        const childParticipants = buildParticipantIds({
          creatorId: actor.uid,
          assigneeId,
          reviewerId: parentReviewer,
          groupId: assigneeUser?.groupId || input.groupId,
          project: selectedProject,
          allUsers,
        });

        batch.set(doc(db, 'tasks', childId), {
          id: childId,
          code: childCode,
          title: `${input.title.trim()} (${assigneeUser?.fullName || 'Nhân sự'})`.slice(0, 200),
          description: input.description.trim().slice(0, 5000),
          projectId: input.projectId,
          groupId: assigneeUser?.groupId || input.groupId,
          creatorId: actor.uid,
          assigneeId,
          reviewerId: parentReviewer,
          parentTaskId: parentId,
          priority: input.priority,
          startDate: input.startDate,
          dueDate: input.dueDate,
          estimatedHours: Number(input.estimatedHours) || 0,
          labels: input.labels.slice(0, 10),
          attachments: input.attachments.slice(0, 10),
          status: 'MOI' as TaskStatus,
          submissionStatus: 'CHUA_NOP' as SubmissionStatus,
          submissionNote: '',
          reviewResult: 'CHO_XAC_NHAN' as ReviewResult,
          reviewNote: '',
          isLocked: false,
          participantIds: childParticipants,
          departmentId: getActiveSpaceId(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      await logSystemAudit({
        actor,
        action: 'Giao việc nhiều người',
        targetType: 'task',
        targetId: parentId,
        detail: `Tạo công việc ${parentCode} và tách thành ${input.assigneeIds.length} việc con độc lập`,
        allUsers,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks/batch');
    }
    return;
  }

  const assigneeId = input.assigneeIds[0] || actor.uid;
  const isSelfCreate = assigneeId === actor.uid;
  const reviewerId =
    input.reviewerId || (isSelfCreate ? actor.managerId || actor.uid : actor.uid);

  const taskId = makeId('tsk');
  const code = `${prefix}-${String(seq).padStart(2, '0')}`;
  const participantIds = buildParticipantIds({
    creatorId: actor.uid,
    assigneeId,
    reviewerId,
    groupId: input.groupId,
    project: selectedProject,
    allUsers,
  });

  try {
    await setDoc(doc(db, 'tasks', taskId), {
      id: taskId,
      code,
      title: input.title.trim().slice(0, 200),
      description: input.description.trim().slice(0, 5000),
      projectId: input.projectId,
      groupId: input.groupId,
      creatorId: actor.uid,
      assigneeId,
      reviewerId,
      parentTaskId: '',
      priority: input.priority,
      startDate: input.startDate,
      dueDate: input.dueDate,
      estimatedHours: Number(input.estimatedHours) || 0,
      labels: input.labels.slice(0, 10),
      attachments: input.attachments.slice(0, 10),
      status: 'MOI' as TaskStatus,
      submissionStatus: 'CHUA_NOP' as SubmissionStatus,
      submissionNote: '',
      reviewResult: 'CHO_XAC_NHAN' as ReviewResult,
      reviewNote: '',
      isLocked: false,
      participantIds,
      departmentId: getActiveSpaceId(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logTaskAudit({
      taskId,
      actor,
      action: isSelfCreate ? 'Tự tạo công việc' : 'Giao công việc',
      detail: `Khởi tạo công việc ${code}: "${input.title.trim()}"`,
      participantIds,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${taskId}`);
  }
}

export async function updateTaskProgressOrSubmit(params: {
  task: TaskItem;
  actor: UserProfile;
  nextStatus: 'MOI' | 'DANG_THUC_HIEN' | 'CHO_XAC_NHAN' | 'TAM_HOAN';
  submissionNote?: string;
  attachments?: string[];
}): Promise<void> {
  const { task, actor, nextStatus, submissionNote, attachments } = params;
  const isSubmitting = nextStatus === 'CHO_XAC_NHAN';
  try {
    await updateDoc(doc(db, 'tasks', task.id), {
      status: nextStatus,
      submissionStatus: isSubmitting ? 'DA_NOP' : task.submissionStatus,
      submissionNote: isSubmitting
        ? (submissionNote || 'Đã hoàn thành và nộp kết quả').slice(0, 1000)
        : task.submissionNote || '',
      attachments: attachments ? attachments.slice(0, 10) : task.attachments || [],
      updatedAt: serverTimestamp(),
    });
    await logTaskAudit({
      taskId: task.id,
      actor,
      action: isSubmitting ? 'Nộp kết quả' : 'Cập nhật trạng thái',
      detail: isSubmitting
        ? `Nộp kết quả công việc: ${submissionNote || 'Chờ xác nhận'}`
        : `Chuyển trạng thái sang ${nextStatus}`,
      participantIds: task.participantIds,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
  }
}

export async function reviewTaskDecision(params: {
  task: TaskItem;
  actor: UserProfile;
  decision: 'APPROVE' | 'REJECT' | 'CANCEL' | 'REOPEN';
  note?: string;
}): Promise<void> {
  const { task, actor, decision, note } = params;
  try {
    if (decision === 'APPROVE') {
      await updateDoc(doc(db, 'tasks', task.id), {
        status: 'HOAN_THANH',
        submissionStatus: 'DA_NOP',
        reviewResult: 'DA_HOAN_THANH',
        reviewNote: (note || 'Đã nghiệm thu hoàn thành').slice(0, 1000),
        isLocked: true,
        updatedAt: serverTimestamp(),
      });
      await logTaskAudit({
        taskId: task.id,
        actor,
        action: 'Xác nhận hoàn thành',
        detail: note?.trim()
          ? `Xác nhận hoàn thành: ${note.trim()}`
          : 'Xác nhận hoàn thành và khóa công việc',
        participantIds: task.participantIds,
      });
    } else if (decision === 'REJECT') {
      const reason = (note || '').trim();
      if (reason.length < 3) {
        throw new Error('Vui lòng nhập lý do chưa hoàn thành (tối thiểu 3 ký tự).');
      }
      await updateDoc(doc(db, 'tasks', task.id), {
        status: 'CHUA_HOAN_THANH',
        submissionStatus: 'CHUA_NOP',
        reviewResult: 'CHUA_HOAN_THANH',
        reviewNote: reason.slice(0, 1000),
        isLocked: false,
        updatedAt: serverTimestamp(),
      });
      await logTaskAudit({
        taskId: task.id,
        actor,
        action: 'Yêu cầu làm lại',
        detail: `Chưa hoàn thành — Lý do: ${reason}`,
        participantIds: task.participantIds,
      });
    } else if (decision === 'REOPEN') {
      const reason = (note || '').trim();
      if (reason.length < 3) {
        throw new Error('Vui lòng nhập lý do mở lại công việc (tối thiểu 3 ký tự).');
      }
      await updateDoc(doc(db, 'tasks', task.id), {
        status: 'DANG_THUC_HIEN',
        submissionStatus: 'CHUA_NOP',
        reviewResult: 'CHUA_HOAN_THANH',
        reviewNote: reason.slice(0, 1000),
        isLocked: false,
        updatedAt: serverTimestamp(),
      });
      await logTaskAudit({
        taskId: task.id,
        actor,
        action: 'Mở lại công việc',
        detail: `Mở lại công việc đã khóa — Lý do: ${reason}`,
        participantIds: task.participantIds,
      });
    } else if (decision === 'CANCEL') {
      await updateDoc(doc(db, 'tasks', task.id), {
        status: 'HUY',
        reviewNote: (note || 'Đã hủy công việc').slice(0, 1000),
        isLocked: false,
        updatedAt: serverTimestamp(),
      });
      await logTaskAudit({
        taskId: task.id,
        actor,
        action: 'Hủy công việc',
        detail: note?.trim() || 'Đã hủy công việc',
        participantIds: task.participantIds,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Vui lòng nhập lý do')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
  }
}

export async function batchApproveTasks(tasks: TaskItem[], actor: UserProfile): Promise<void> {
  if (tasks.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const t of tasks) {
      batch.update(doc(db, 'tasks', t.id), {
        status: 'HOAN_THANH',
        submissionStatus: 'DA_NOP',
        reviewResult: 'DA_HOAN_THANH',
        reviewNote: 'Duyệt hoàn thành hàng loạt',
        isLocked: true,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'tasks/batchApprove');
  }
}

export async function addSubtask(
  task: TaskItem,
  title: string,
  actor: UserProfile
): Promise<void> {
  const id = makeId('sub');
  try {
    await setDoc(doc(db, 'tasks', task.id, 'subtasks', id), {
      id,
      title: title.trim().slice(0, 200),
      isDone: false,
      createdBy: actor.uid,
      taskParticipantIds: task.participantIds.slice(0, 50),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${task.id}/subtasks/${id}`);
  }
}

export async function toggleSubtask(
  task: TaskItem,
  subtaskId: string,
  isDone: boolean
): Promise<void> {
  try {
    await updateDoc(doc(db, 'tasks', task.id, 'subtasks', subtaskId), {
      isDone,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}/subtasks/${subtaskId}`);
  }
}

export async function addTaskComment(
  task: TaskItem,
  content: string,
  mentions: string[],
  actor: UserProfile
): Promise<void> {
  const id = makeId('cmt');
  try {
    await setDoc(doc(db, 'tasks', task.id, 'comments', id), {
      id,
      authorId: actor.uid,
      authorName: actor.fullName,
      content: content.trim().slice(0, 2000),
      mentions: mentions.slice(0, 20),
      taskParticipantIds: task.participantIds.slice(0, 50),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tasks/${task.id}/comments/${id}`);
  }
}

export async function saveProject(params: {
  existing?: Project;
  input: {
    code: string;
    name: string;
    description: string;
    startDate: string;
    expectedEndDate: string;
    status: ProjectStatus;
    pmId: string;
    memberIds: string[];
    labels: string[];
  };
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { existing, input, actor, allUsers } = params;
  const id = existing ? existing.id : makeId('prj');
  const validUidSet = new Set(allUsers.filter((u) => u.isActive).map((u) => u.uid));
  const canEditMembers = !existing || canManageProjectMembers(actor);

  const resolvedPmId = canEditMembers
    ? validUidSet.has(input.pmId)
      ? input.pmId
      : actor.uid
    : existing.pmId;

  // Strictly keep only PM + explicitly selected active members (never auto-add unrelated leadership)
  const memberIds = canEditMembers
    ? Array.from(
        new Set(
          [resolvedPmId, ...input.memberIds].filter(
            (uid) => Boolean(uid) && (validUidSet.has(uid) || uid === resolvedPmId)
          )
        )
      ).slice(0, 50)
    : existing.memberIds;

  try {
    const batch = writeBatch(db);
    if (existing) {
      batch.update(doc(db, 'projects', id), {
        code: input.code.trim().toUpperCase().slice(0, 32),
        name: input.name.trim().slice(0, 160),
        description: input.description.trim().slice(0, 2000),
        startDate: input.startDate,
        expectedEndDate: input.expectedEndDate,
        status: input.status,
        pmId: resolvedPmId,
        memberIds,
        labels: input.labels.slice(0, 15),
        updatedAt: serverTimestamp(),
      });

      if (canEditMembers) {
        const existingMembersSnap = await getDocs(collection(db, 'projects', id, 'members'));
        const nextMemberSet = new Set(memberIds);
        for (const mDoc of existingMembersSnap.docs) {
          if (!nextMemberSet.has(mDoc.id)) {
            batch.delete(mDoc.ref);
          }
        }
        for (const uid of memberIds) {
          batch.set(doc(db, 'projects', id, 'members', uid), {
            userId: uid,
            projectRole: uid === resolvedPmId ? 'QUAN_LY_DU_AN' : 'THANH_VIEN',
            joinedAt: serverTimestamp(),
          });
        }
      }
    } else {
      batch.set(doc(db, 'projects', id), {
        id,
        code: input.code.trim().toUpperCase().slice(0, 32),
        name: input.name.trim().slice(0, 160),
        description: input.description.trim().slice(0, 2000),
        startDate: input.startDate,
        expectedEndDate: input.expectedEndDate,
        status: input.status,
        pmId: resolvedPmId,
        memberIds,
        labels: input.labels.slice(0, 15),
        createdBy: actor.uid,
        departmentId: getActiveSpaceId(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const uid of memberIds) {
        batch.set(doc(db, 'projects', id, 'members', uid), {
          userId: uid,
          projectRole: uid === resolvedPmId ? 'QUAN_LY_DU_AN' : 'THANH_VIEN',
          joinedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
    await logSystemAudit({
      actor,
      action: existing ? 'Cập nhật dự án' : 'Tạo dự án',
      targetType: 'project',
      targetId: id,
      detail: `${existing ? 'Cập nhật' : 'Tạo mới'} dự án ${input.code.toUpperCase()} - ${input.name} (${memberIds.length} thành viên)`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${id}`);
  }
}

export async function addProjectMember(params: {
  project: Project;
  memberUid: string;
  projectRole?: 'QUAN_LY_DU_AN' | 'THANH_VIEN';
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { project, memberUid, projectRole = 'THANH_VIEN', actor, allUsers } = params;
  if (!canManageProjectMembers(actor)) {
    throw new Error('Chỉ Trưởng phòng hoặc Quản trị viên mới có quyền thêm thành viên dự án.');
  }
  const targetUser = allUsers.find((u) => u.uid === memberUid && u.isActive);
  if (!targetUser) {
    throw new Error('Không tìm thấy nhân sự hợp lệ để thêm vào dự án.');
  }
  if (project.memberIds.includes(memberUid)) {
    throw new Error('Nhân sự này đã là thành viên của dự án.');
  }
  if (project.memberIds.length >= 50) {
    throw new Error('Dự án đã đạt tối đa 50 thành viên.');
  }

  const nextMemberIds = Array.from(new Set([...project.memberIds, memberUid])).slice(0, 50);
  const nextPmId = projectRole === 'QUAN_LY_DU_AN' ? memberUid : project.pmId;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'projects', project.id), {
      memberIds: nextMemberIds,
      pmId: nextPmId,
      updatedAt: serverTimestamp(),
    });
    if (projectRole === 'QUAN_LY_DU_AN' && project.pmId && project.pmId !== memberUid) {
      batch.set(doc(db, 'projects', project.id, 'members', project.pmId), {
        userId: project.pmId,
        projectRole: 'THANH_VIEN',
        joinedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'projects', project.id, 'members', memberUid), {
      userId: memberUid,
      projectRole,
      joinedAt: serverTimestamp(),
    });
    await batch.commit();

    await logSystemAudit({
      actor,
      action: 'Thêm thành viên dự án',
      targetType: 'project',
      targetId: project.id,
      detail: `Thêm ${targetUser.fullName} (${targetUser.employeeCode}) vào dự án ${project.code} với vai trò ${projectRole === 'QUAN_LY_DU_AN' ? 'Quản lý dự án (PM)' : 'Thành viên'}`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}/members/${memberUid}`);
  }
}

export async function updateProjectMember(params: {
  project: Project;
  currentMemberUid: string;
  nextMemberUid: string;
  nextRole: 'QUAN_LY_DU_AN' | 'THANH_VIEN';
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { project, currentMemberUid, nextMemberUid, nextRole, actor, allUsers } = params;
  if (!canManageProjectMembers(actor)) {
    throw new Error('Chỉ Trưởng phòng hoặc Quản trị viên mới có quyền sửa thành viên dự án.');
  }

  const nextUser = allUsers.find((u) => u.uid === nextMemberUid && u.isActive);
  if (!nextUser) {
    throw new Error('Nhân sự được chọn không hợp lệ hoặc đã ngừng hoạt động.');
  }

  const isReplacingUser = currentMemberUid !== nextMemberUid;
  if (isReplacingUser && project.memberIds.includes(nextMemberUid)) {
    throw new Error('Nhân sự thay thế đã có mặt trong danh sách thành viên dự án.');
  }

  const wasPm = currentMemberUid === project.pmId;
  if (wasPm && nextRole !== 'QUAN_LY_DU_AN') {
    throw new Error(
      'Dự án luôn cần một Quản lý dự án (PM). Để hạ vai trò người này, hãy chọn một thành viên khác làm PM hoặc thay thế bằng nhân sự khác.'
    );
  }

  const nextMemberIds = isReplacingUser
    ? project.memberIds.map((uid) => (uid === currentMemberUid ? nextMemberUid : uid))
    : project.memberIds;

  const nextPmId = nextRole === 'QUAN_LY_DU_AN' ? nextMemberUid : project.pmId;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'projects', project.id), {
      memberIds: nextMemberIds,
      pmId: nextPmId,
      updatedAt: serverTimestamp(),
    });

    if (isReplacingUser) {
      batch.delete(doc(db, 'projects', project.id, 'members', currentMemberUid));
    }

    if (nextRole === 'QUAN_LY_DU_AN' && project.pmId && project.pmId !== currentMemberUid) {
      batch.set(doc(db, 'projects', project.id, 'members', project.pmId), {
        userId: project.pmId,
        projectRole: 'THANH_VIEN',
        joinedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'projects', project.id, 'members', nextMemberUid), {
      userId: nextMemberUid,
      projectRole: nextRole,
      joinedAt: serverTimestamp(),
    });

    await batch.commit();

    const prevUser = allUsers.find((u) => u.uid === currentMemberUid);
    const roleLabel = nextRole === 'QUAN_LY_DU_AN' ? 'Quản lý dự án (PM)' : 'Thành viên';
    const detailText = isReplacingUser
      ? `Thay thế ${prevUser?.fullName || currentMemberUid} bằng ${nextUser.fullName} (${nextUser.employeeCode}) với vai trò ${roleLabel} trong dự án ${project.code}`
      : `Cập nhật vai trò của ${nextUser.fullName} (${nextUser.employeeCode}) thành ${roleLabel} trong dự án ${project.code}`;

    await logSystemAudit({
      actor,
      action: 'Sửa thành viên dự án',
      targetType: 'project',
      targetId: project.id,
      detail: detailText,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}/members/${nextMemberUid}`);
  }
}

export async function removeProjectMember(params: {
  project: Project;
  memberUid: string;
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { project, memberUid, actor, allUsers } = params;
  if (!canManageProjectMembers(actor)) {
    throw new Error('Chỉ Trưởng phòng hoặc Quản trị viên mới có quyền xóa thành viên dự án.');
  }
  if (memberUid === project.pmId) {
    throw new Error(
      'Không thể xóa Quản lý dự án (PM). Hãy chọn một thành viên khác làm PM bằng nút Sửa trước khi xóa.'
    );
  }
  const nextMemberIds = project.memberIds.filter((uid) => uid !== memberUid);
  if (nextMemberIds.length === 0) {
    throw new Error('Dự án phải có ít nhất 1 thành viên.');
  }

  const targetUser = allUsers.find((u) => u.uid === memberUid);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'projects', project.id), {
      memberIds: nextMemberIds,
      updatedAt: serverTimestamp(),
    });
    batch.delete(doc(db, 'projects', project.id, 'members', memberUid));
    await batch.commit();

    await logSystemAudit({
      actor,
      action: 'Xóa thành viên dự án',
      targetType: 'project',
      targetId: project.id,
      detail: `Xóa ${targetUser ? `${targetUser.fullName} (${targetUser.employeeCode})` : memberUid} khỏi dự án ${project.code}`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/members/${memberUid}`);
  }
}

export async function saveWorkLog(params: {
  userId: string;
  task: TaskItem;
  workDate: string;
  hours: number;
  progressPercent: number;
  note: string;
  allUsers: UserProfile[];
  existingId?: string;
}): Promise<void> {
  const { userId, task, workDate, hours, progressPercent, note, allUsers, existingId } = params;
  const id = existingId || makeId('wl');
  const viewerIds = Array.from(
    new Set([
      userId,
      task.reviewerId,
      ...allUsers
        .filter(
          (u) =>
            u.roles.includes('ADMIN') ||
            u.roles.includes('TRUONG_PHONG') ||
            u.roles.includes('PHO_PHONG') ||
            (u.roles.includes('TRUONG_NHOM') && u.groupId === task.groupId)
        )
        .map((u) => u.uid),
    ])
  ).slice(0, 30);

  try {
    if (existingId) {
      await updateDoc(doc(db, 'workLogs', existingId), {
        taskId: task.id,
        projectId: task.projectId || '',
        hours: Number(hours),
        progressPercent: Number(progressPercent),
        note: note.trim().slice(0, 1000),
        viewerIds,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'workLogs', id), {
        id,
        userId,
        taskId: task.id,
        projectId: task.projectId || '',
        workDate,
        workDateNum: dateStrToNum(workDate),
        hours: Number(hours),
        progressPercent: Number(progressPercent),
        note: note.trim().slice(0, 1000),
        viewerIds,
        departmentId: getActiveSpaceId(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workLogs/${id}`);
  }
}

export async function unlockWorkLogDate(params: {
  targetUser: UserProfile;
  workDate: string;
  reason: string;
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { targetUser, workDate, reason, actor, allUsers } = params;
  const id = `${targetUser.uid}_${workDate}`;
  try {
    await setDoc(doc(db, 'workLogUnlocks', id), {
      id,
      userId: targetUser.uid,
      workDate,
      unlockedBy: actor.uid,
      reason: reason.trim().slice(0, 500),
      departmentId: getActiveSpaceId(),
      unlockedAt: serverTimestamp(),
    });
    await logSystemAudit({
      actor,
      action: 'Mở khóa log work',
      targetType: 'workLogUnlock',
      targetId: id,
      detail: `Mở khóa ngày ${workDate} cho ${targetUser.fullName}. Lý do: ${reason.trim()}`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workLogUnlocks/${id}`);
  }
}

export async function saveUserByAdmin(params: {
  existing?: UserProfile;
  input: {
    username: string;
    initialPassword?: string;
    email: string;
    fullName: string;
    employeeCode: string;
    title: string;
    roles: RoleCode[];
    groupId: string;
    managerId: string;
    isActive: boolean;
  };
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { existing, input, actor, allUsers } = params;
  const uid = existing ? existing.uid : makeId('usr');
  const username = normalizeUsername(existing?.username || input.username);
  const emailLower = input.email.trim().toLowerCase();

  if (username && !isValidUsernameFormat(username)) {
    throw new Error(
      'Tên đăng nhập chỉ được chứa chữ thường (a-z), số (0-9), dấu chấm (.), gạch dưới (_) hoặc gạch ngang (-), độ dài 2–64 ký tự.'
    );
  }

  const spaceId = getActiveSpaceId();
  const spaceKey = await getOrInitSpaceAesKey(spaceId);

  const duplicateUser = allUsers.find(
    (u) => u.uid !== uid && normalizeUsername(u.username || '') === username && username !== ''
  );
  if (duplicateUser) {
    throw new Error(`Tên đăng nhập "${username}" đã tồn tại. Vui lòng chọn tên khác.`);
  }

  const needsAuthProvision = !existing || !existing.authUid;
  let provisionedAuthUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'] | null =
    null;
  let createdFreshAuthUser = false;

  if (needsAuthProvision) {
    if (!username) {
      throw new Error('Vui lòng nhập tên đăng nhập cho tài khoản.');
    }
    const pwd = input.initialPassword || '';
    const strengthErr = validatePasswordStrength(pwd);
    if (strengthErr) {
      throw new Error(`Mật khẩu khởi tạo không đạt yêu cầu: ${strengthErr}`);
    }

    const internalEmail = getInternalAuthEmail(username);
    try {
      const cred = await createUserWithEmailAndPassword(
        provisionerAuth,
        internalEmail,
        pwd
      );
      provisionedAuthUser = cred.user;
      createdFreshAuthUser = true;
    } catch (err) {
      const code = getAuthErrorCode(err);
      if (code === 'auth/email-already-in-use') {
        try {
          const cred = await signInWithEmailAndPassword(
            provisionerAuth,
            internalEmail,
            pwd
          );
          const existingBinding = await getDocFromServer(doc(db, 'authBindings', cred.user.uid));
          if (existingBinding.exists() && existingBinding.data()?.userId !== uid) {
            throw new Error(
              `Tên đăng nhập "${username}" đang được liên kết với một tài khoản nhân sự khác.`
            );
          }
          provisionedAuthUser = cred.user;
        } catch (recoverErr) {
          if (
            recoverErr instanceof Error &&
            recoverErr.message.includes('đang được liên kết')
          ) {
            throw recoverErr;
          }
          throw new Error(
            `Tên đăng nhập "${username}" đã tồn tại trên Firebase Auth (có thể từ trước khi xóa dữ liệu). Hãy nhập đúng mật khẩu cũ của tài khoản đó để khôi phục liên kết, hoặc chọn tên đăng nhập khác.`
          );
        }
      } else if (code === 'auth/operation-not-allowed') {
        throw new Error(
          'Phương thức Email/Password chưa được bật trong Firebase Authentication.'
        );
      } else {
        throw new Error(
          err instanceof Error ? err.message : 'Không thể khởi tạo tài khoản Firebase Auth.'
        );
      }
    }
  }

  const sanitizedRoles = sanitizeRolesList(input.roles);
  const sanitizedGroupId = (input.groupId || '').trim().slice(0, 64);
  const sanitizedManagerId = (input.managerId || '').trim().slice(0, 128);
  const resolvedAuthUid = provisionedAuthUser?.uid || existing?.authUid || '';
  const payload: EncryptedAccountPayload = {
    username,
    employeeCode: input.employeeCode.trim().slice(0, 32),
    fullName: input.fullName.trim().slice(0, 120),
    title: input.title.trim().slice(0, 120),
    email: emailLower,
  };
  const encryptedAccount = await encryptAccountData(spaceKey, payload);
  const resolvedActive = existing && existing.uid === actor.uid ? true : input.isActive;
  let currentStep = 'user_doc';

  try {
    if (existing) {
      const existingSnap = await getDocFromServer(doc(db, 'users', uid));
      const existingRaw = existingSnap.exists() ? existingSnap.data() : null;
      await setDoc(doc(db, 'users', uid), {
        uid,
        authUid: resolvedAuthUid,
        encryptedAccount,
        mustChangePassword: provisionedAuthUser
          ? true
          : Boolean(existingRaw?.mustChangePassword),
        roles: sanitizedRoles,
        groupId: sanitizedGroupId,
        managerId: sanitizedManagerId,
        isActive: resolvedActive,
        departmentId: spaceId,
        createdAt: isFirestoreTimestampValue(existingRaw?.createdAt)
          ? existingRaw.createdAt
          : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (resolvedAuthUid) {
        currentStep = 'auth_binding';
        const isDuplicateSharingActorAuth =
          Boolean(actor.authUid) && resolvedAuthUid === actor.authUid && uid !== actor.uid;
        if (!isDuplicateSharingActorAuth) {
          await upsertAuthBinding({
            authUid: resolvedAuthUid,
            userId: uid,
            departmentId: spaceId,
            isActive: resolvedActive,
          });
        }
      }
    } else {
      await setDoc(doc(db, 'users', uid), {
        uid,
        authUid: resolvedAuthUid,
        encryptedAccount,
        mustChangePassword: true,
        roles: sanitizedRoles,
        groupId: sanitizedGroupId,
        managerId: sanitizedManagerId,
        isActive: resolvedActive,
        departmentId: spaceId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      currentStep = 'auth_binding';
      await upsertAuthBinding({
        authUid: resolvedAuthUid,
        userId: uid,
        departmentId: spaceId,
        isActive: resolvedActive,
      });
    }

    if (emailLower) {
      currentStep = 'private_info';
      const encryptedPrivate = await encryptPrivateData(spaceKey, { email: emailLower });
      await setDoc(doc(db, 'users', uid, 'private', 'info'), {
        uid,
        encryptedPrivate,
        updatedAt: serverTimestamp(),
      });
    }

    currentStep = 'audit_log';
    await logSystemAudit({
      actor,
      action: existing ? 'Cập nhật nhân sự' : 'Tạo nhân sự mới',
      targetType: 'user',
      targetId: uid,
      detail: `${existing ? 'Cập nhật' : 'Tạo mới'} ${input.fullName} (${input.employeeCode}, @${username || 'chưa gắn TK'}) - Vai trò: ${sanitizedRoles.join(', ')}`,
      allUsers,
    });
  } catch (error) {
    if (provisionedAuthUser && createdFreshAuthUser) {
      try {
        await deleteUser(provisionedAuthUser);
      } catch {
        // ignore rollback error
      }
    }
    console.error(`saveUserByAdmin failed at step=${currentStep} for users/${uid}:`, error);
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  } finally {
    try {
      await signOut(provisionerAuth);
    } catch {
      // ignore
    }
  }
}

export async function toggleUserLockByAdmin(params: {
  targetUser: UserProfile;
  nextActive: boolean;
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { targetUser, nextActive, actor, allUsers } = params;
  if (!targetUser.authUid || !targetUser.encryptedAccount) {
    throw new Error(
      'Tài khoản cũ chưa kích hoạt Firebase Auth & mã hóa dữ liệu. Vui lòng bấm "Kích hoạt Auth" hoặc "Sửa" cho nhân sự này trước.'
    );
  }
  const spaceId = getActiveSpaceId();
  try {
    const userRef = doc(db, 'users', targetUser.uid);
    const userSnap = await getDocFromServer(userRef);
    const raw = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : null;
    await setDoc(userRef, {
      uid: targetUser.uid,
      authUid: targetUser.authUid,
      encryptedAccount:
        (raw && typeof raw.encryptedAccount === 'string' && raw.encryptedAccount) ||
        targetUser.encryptedAccount,
      mustChangePassword: Boolean(raw?.mustChangePassword),
      roles: sanitizeRolesList(raw?.roles ?? targetUser.roles),
      groupId: (typeof raw?.groupId === 'string' ? raw.groupId : targetUser.groupId || '').trim().slice(0, 64),
      managerId: (typeof raw?.managerId === 'string' ? raw.managerId : targetUser.managerId || '').trim().slice(0, 128),
      isActive: nextActive,
      departmentId: spaceId,
      createdAt: isFirestoreTimestampValue(raw?.createdAt) ? raw.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const isDuplicateSharingActorAuth =
      Boolean(actor.authUid) &&
      targetUser.authUid === actor.authUid &&
      targetUser.uid !== actor.uid;
    if (!isDuplicateSharingActorAuth) {
      await upsertAuthBinding({
        authUid: targetUser.authUid,
        userId: targetUser.uid,
        departmentId: spaceId,
        isActive: nextActive,
      });
    }

    await logSystemAudit({
      actor,
      action: nextActive ? 'Mở khóa tài khoản' : 'Khóa tài khoản',
      targetType: 'user',
      targetId: targetUser.uid,
      detail: `${nextActive ? 'Mở khóa' : 'Khóa'} tài khoản ${targetUser.fullName} (@${targetUser.username || targetUser.employeeCode})`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function activateLegacyUserAuthByAdmin(params: {
  targetUser: UserProfile;
  usernameInput?: string;
  initialPassword: string;
  requireChangeOnNextLogin: boolean;
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const {
    targetUser,
    usernameInput,
    initialPassword,
    requireChangeOnNextLogin,
    actor,
    allUsers,
  } = params;

  if (targetUser.authUid) {
    throw new Error('Nhân sự này đã được kích hoạt tài khoản Firebase Auth.');
  }

  const username = normalizeUsername(targetUser.username || usernameInput || '');
  if (!isValidUsernameFormat(username)) {
    throw new Error(
      'Tên đăng nhập không hợp lệ (2–64 ký tự gồm a-z, 0-9, dấu chấm, gạch dưới hoặc gạch ngang).'
    );
  }
  const strengthError = validatePasswordStrength(initialPassword);
  if (strengthError) {
    throw new Error(strengthError);
  }

  const spaceId = getActiveSpaceId();
  const spaceKey = await getOrInitSpaceAesKey(spaceId);
  const internalEmail = getInternalAuthEmail(username);

  let provisionedUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'] | null =
    null;
  try {
    const cred = await createUserWithEmailAndPassword(
      provisionerAuth,
      internalEmail,
      initialPassword
    );
    provisionedUser = cred.user;

    const existingSnap = await getDocFromServer(doc(db, 'users', targetUser.uid));
    const existingRaw = existingSnap.exists() ? existingSnap.data() : null;
    const email = await fetchUserEmailForAdmin(targetUser.uid);

    const encryptedAccount = await encryptAccountData(spaceKey, {
      username,
      employeeCode: (targetUser.employeeCode || 'NV').trim().slice(0, 32),
      fullName: (targetUser.fullName || 'Nhân sự').trim().slice(0, 120),
      title: (targetUser.title || '').trim().slice(0, 120),
      email,
    });

    await setDoc(doc(db, 'users', targetUser.uid), {
      uid: targetUser.uid,
      authUid: provisionedUser.uid,
      encryptedAccount,
      mustChangePassword: requireChangeOnNextLogin,
      roles: sanitizeRolesList(targetUser.roles),
      groupId: (targetUser.groupId || '').trim().slice(0, 64),
      managerId: (targetUser.managerId || '').trim().slice(0, 128),
      isActive: targetUser.isActive,
      departmentId: spaceId,
      createdAt: isFirestoreTimestampValue(existingRaw?.createdAt)
        ? existingRaw.createdAt
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await upsertAuthBinding({
      authUid: provisionedUser.uid,
      userId: targetUser.uid,
      departmentId: spaceId,
      isActive: targetUser.isActive,
    });

    if (email) {
      const encryptedPrivate = await encryptPrivateData(spaceKey, { email });
      await setDoc(doc(db, 'users', targetUser.uid, 'private', 'info'), {
        uid: targetUser.uid,
        encryptedPrivate,
        updatedAt: serverTimestamp(),
      });
    }

    await logSystemAudit({
      actor,
      action: 'Kích hoạt Firebase Auth',
      targetType: 'user',
      targetId: targetUser.uid,
      detail: `Kích hoạt đăng nhập Firebase Auth & mã hóa hồ sơ cho ${targetUser.fullName} (@${username})`,
      allUsers,
    });
  } catch (error) {
    if (provisionedUser) {
      try {
        await deleteUser(provisionedUser);
      } catch {
        // ignore
      }
    }
    const code = getAuthErrorCode(error);
    if (code === 'auth/email-already-in-use') {
      throw new Error(`Tên đăng nhập "${username}" đã tồn tại trên Firebase Auth.`);
    }
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Phương thức Email/Password chưa được bật trong Firebase Authentication.'
      );
    }
    handleFirestoreError(error, OperationType.WRITE, `users/${targetUser.uid}`);
  } finally {
    try {
      await signOut(provisionerAuth);
    } catch {
      // ignore
    }
  }
}

export async function createGroupByAdmin(params: {
  code: string;
  name: string;
  description: string;
  leaderId: string;
  allUsers: UserProfile[];
  actor: UserProfile;
}): Promise<void> {
  const { code, name, description, leaderId, allUsers, actor } = params;
  const id = makeId('grp');
  const memberUids = Array.from(
    new Set([...allUsers.map((u) => u.uid), ...(leaderId ? [leaderId] : [])])
  ).slice(0, 50);

  try {
    await setDoc(doc(db, 'groups', id), {
      id,
      code: code.trim().toUpperCase().slice(0, 32),
      name: name.trim().slice(0, 120),
      description: description.trim().slice(0, 500),
      leaderId: leaderId || '',
      memberUids,
      departmentId: getActiveSpaceId(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logSystemAudit({
      actor,
      action: 'Tạo nhóm việc',
      targetType: 'group',
      targetId: id,
      detail: `Tạo nhóm ${code.trim().toUpperCase()}: ${name.trim()}`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `groups/${id}`);
  }
}

export async function saveGroupByAdmin(params: {
  group: WorkGroup;
  name: string;
  description: string;
  leaderId: string;
  allUsers: UserProfile[];
  actor: UserProfile;
}): Promise<void> {
  const { group, name, description, leaderId, allUsers, actor } = params;
  const memberUids = Array.from(
    new Set([...allUsers.map((u) => u.uid), ...(leaderId ? [leaderId] : [])])
  ).slice(0, 50);

  try {
    await updateDoc(doc(db, 'groups', group.id), {
      name: name.trim().slice(0, 120),
      description: description.trim().slice(0, 500),
      leaderId: leaderId || '',
      memberUids,
      updatedAt: serverTimestamp(),
    });
    await logSystemAudit({
      actor,
      action: 'Cập nhật nhóm việc',
      targetType: 'group',
      targetId: group.id,
      detail: `Cập nhật nhóm ${group.code}: ${name.trim()}`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `groups/${group.id}`);
  }
}

export async function saveSystemConfigByAdmin(params: {
  config: SystemConfig;
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { config, actor, allUsers } = params;
  const spaceId = getActiveSpaceId();
  const cfgId = getSystemConfigDocId();
  try {
    await setDoc(doc(db, 'systemConfigs', cfgId), {
      lockHour: Number(config.lockHour),
      lockMinute: Number(config.lockMinute),
      reminderHour: Number(config.reminderHour),
      reminderMinute: Number(config.reminderMinute),
      timezone: 'Asia/Ho_Chi_Minh',
      defaultLabels: config.defaultLabels.slice(0, 30),
      holidays: (config.holidays || []).slice(0, 50),
      departmentId: spaceId,
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    await logSystemAudit({
      actor,
      action: 'Cập nhật cấu hình hệ thống',
      targetType: 'systemConfig',
      targetId: cfgId,
      detail: `Giờ khóa ngày: ${config.lockHour}:${String(config.lockMinute).padStart(2, '0')} UTC+7`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `systemConfigs/${cfgId}`);
  }
}

export async function wipeAllDepartmentData(actor: UserProfile): Promise<{
  deletedDocs: number;
  normalizedAdmin: UserProfile;
}> {
  let deletedDocs = 0;
  const spaceId = getActiveSpaceId();
  const cfgId = getSystemConfigDocId();
  const defaultAdminUid = getDefaultAdminUid();
  let currentStep = 'init';

  try {
    // 1. Delete tasks and their subcollections (subtasks, comments, auditLogs)
    currentStep = 'tasks';
    const tasksSnap = await getDocs(
      query(collection(db, 'tasks'), where('departmentId', '==', spaceId))
    );
    const subDeleteOps: Array<(b: WriteBatch) => void> = [];
    const taskDeleteOps: Array<(b: WriteBatch) => void> = [];

    for (const taskDoc of tasksSnap.docs) {
      const [subSnap, cmtSnap, audSnap] = await Promise.all([
        getDocs(collection(db, 'tasks', taskDoc.id, 'subtasks')),
        getDocs(collection(db, 'tasks', taskDoc.id, 'comments')),
        getDocs(collection(db, 'tasks', taskDoc.id, 'auditLogs')),
      ]);
      for (const s of subSnap.docs) {
        subDeleteOps.push((b) => b.delete(s.ref));
        deletedDocs += 1;
      }
      for (const c of cmtSnap.docs) {
        subDeleteOps.push((b) => b.delete(c.ref));
        deletedDocs += 1;
      }
      for (const a of audSnap.docs) {
        subDeleteOps.push((b) => b.delete(a.ref));
        deletedDocs += 1;
      }
      taskDeleteOps.push((b) => b.delete(taskDoc.ref));
      deletedDocs += 1;
    }

    // Subcollection rules call get(tasks/{taskId}); keep batch <= 8 to stay well under Firestore's per-batch get/exists limit
    if (subDeleteOps.length > 0) await runBatchOps(subDeleteOps, 8);
    if (taskDeleteOps.length > 0) await runBatchOps(taskDeleteOps);

    // 2. Delete workLogs & workLogUnlocks
    currentStep = 'workLogs';
    const [wlSnap, ulSnap] = await Promise.all([
      getDocs(query(collection(db, 'workLogs'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'workLogUnlocks'), where('departmentId', '==', spaceId))),
    ]);
    const wlOps: Array<(b: WriteBatch) => void> = [];
    for (const d of wlSnap.docs) {
      wlOps.push((b) => b.delete(d.ref));
      deletedDocs += 1;
    }
    for (const d of ulSnap.docs) {
      wlOps.push((b) => b.delete(d.ref));
      deletedDocs += 1;
    }
    if (wlOps.length > 0) await runBatchOps(wlOps);

    // 3. Delete projects & project members
    currentStep = 'projects';
    const prjSnap = await getDocs(
      query(collection(db, 'projects'), where('departmentId', '==', spaceId))
    );
    const prjMemberOps: Array<(b: WriteBatch) => void> = [];
    const prjDeleteOps: Array<(b: WriteBatch) => void> = [];
    for (const pDoc of prjSnap.docs) {
      const mSnap = await getDocs(collection(db, 'projects', pDoc.id, 'members'));
      for (const m of mSnap.docs) {
        prjMemberOps.push((b) => b.delete(m.ref));
        deletedDocs += 1;
      }
      prjDeleteOps.push((b) => b.delete(pDoc.ref));
      deletedDocs += 1;
    }
    if (prjMemberOps.length > 0) await runBatchOps(prjMemberOps, 8);
    if (prjDeleteOps.length > 0) await runBatchOps(prjDeleteOps);

    // 4. Delete groups, system auditLogs, and systemConfigs
    currentStep = 'groups_configs';
    const [grpSnap, audSnap, cfgSnap] = await Promise.all([
      getDocs(query(collection(db, 'groups'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'auditLogs'), where('departmentId', '==', spaceId))),
      getDoc(doc(db, 'systemConfigs', cfgId)),
    ]);
    const miscOps: Array<(b: WriteBatch) => void> = [];
    for (const d of grpSnap.docs) {
      miscOps.push((b) => b.delete(d.ref));
      deletedDocs += 1;
    }
    for (const d of audSnap.docs) {
      miscOps.push((b) => b.delete(d.ref));
      deletedDocs += 1;
    }
    if (cfgSnap.exists()) {
      miscOps.push((b) => b.delete(cfgSnap.ref));
      deletedDocs += 1;
    }
    if (miscOps.length > 0) await runBatchOps(miscOps);

    // 5. Delete ALL non-admin user accounts, private info & authBindings
    currentStep = 'users_cleanup';
    const usersSnap = await getDocs(
      query(collection(db, 'users'), where('departmentId', '==', spaceId))
    );
    const keptAdminUid = usersSnap.docs.some((d) => d.id === defaultAdminUid)
      ? defaultAdminUid
      : actor.uid;
    const protectedAuthUids = new Set<string>();
    for (const uDoc of usersSnap.docs) {
      if (uDoc.id === keptAdminUid) {
        const uData = uDoc.data() as Record<string, unknown>;
        if (typeof uData.authUid === 'string' && uData.authUid) {
          protectedAuthUids.add(uData.authUid);
        }
      }
    }
    if (keptAdminUid === actor.uid && actor.authUid) {
      protectedAuthUids.add(actor.authUid);
    }

    const bindingAndPrivateOps: Array<(b: WriteBatch) => void> = [];
    const userDeleteOps: Array<(b: WriteBatch) => void> = [];
    for (const uDoc of usersSnap.docs) {
      if (uDoc.id === keptAdminUid) {
        continue;
      }
      const uData = uDoc.data() as Record<string, unknown>;
      if (
        typeof uData.authUid === 'string' &&
        uData.authUid &&
        !protectedAuthUids.has(uData.authUid)
      ) {
        const bUid = uData.authUid;
        try {
          const bSnap = await getDocFromServer(doc(db, 'authBindings', bUid));
          if (
            bSnap.exists() &&
            bSnap.data()?.userId === uDoc.id &&
            bSnap.data()?.userId !== keptAdminUid &&
            bSnap.data()?.userId !== defaultAdminUid
          ) {
            bindingAndPrivateOps.push((b) => b.delete(doc(db, 'authBindings', bUid)));
            deletedDocs += 1;
          }
        } catch {
          // ignore unowned or missing authBindings
        }
      }
      try {
        const privRef = doc(db, 'users', uDoc.id, 'private', 'info');
        const privSnap = await getDocFromServer(privRef);
        if (privSnap.exists()) {
          bindingAndPrivateOps.push((b) => b.delete(privRef));
          deletedDocs += 1;
        }
      } catch {
        // ignore missing private/info
      }
      userDeleteOps.push((b) => b.delete(uDoc.ref));
      deletedDocs += 1;
    }
    if (bindingAndPrivateOps.length > 0) await runBatchOps(bindingAndPrivateOps, 8);
    if (userDeleteOps.length > 0) await runBatchOps(userDeleteOps);

    // 6. Normalize the sole kept Admin account as pure ADMIN (encrypted) & ensure binding
    currentStep = 'normalize_admin';
    const spaceKey = await getOrInitSpaceAesKey(spaceId);
    const actorSnap = await getDocFromServer(doc(db, 'users', keptAdminUid));
    const actorRaw = actorSnap.exists() ? (actorSnap.data() as Record<string, unknown>) : null;
    const decodedKeptAdmin = actorRaw ? await decodeUserProfileDoc(actorRaw, spaceKey) : null;
    const isActorTheKeptAdmin = actor.uid === keptAdminUid;

    const resolvedAuthUid =
      (actorRaw && typeof actorRaw.authUid === 'string' && actorRaw.authUid) ||
      (isActorTheKeptAdmin ? actor.authUid : '') ||
      auth.currentUser?.uid ||
      keptAdminUid;
    const normalizedRoles: RoleCode[] = ['ADMIN'];
    const adminPayload: EncryptedAccountPayload = {
      username:
        decodedKeptAdmin?.username ||
        (isActorTheKeptAdmin ? actor.username : '') ||
        DEFAULT_ADMIN_USERNAME,
      employeeCode:
        decodedKeptAdmin?.employeeCode ||
        (isActorTheKeptAdmin ? actor.employeeCode : '') ||
        'AD-01',
      fullName:
        decodedKeptAdmin?.fullName ||
        (isActorTheKeptAdmin ? actor.fullName : '') ||
        'Quản trị hệ thống',
      title: 'Quản trị hệ thống',
      email: decodedKeptAdmin?.email || (isActorTheKeptAdmin ? actor.email : '') || '',
    };
    const encryptedAccount = await encryptAccountData(spaceKey, adminPayload);

    await setDoc(doc(db, 'users', keptAdminUid), {
      uid: keptAdminUid,
      authUid: resolvedAuthUid,
      encryptedAccount,
      mustChangePassword: Boolean(actorRaw?.mustChangePassword),
      roles: normalizedRoles,
      groupId: '',
      managerId: '',
      isActive: true,
      departmentId: spaceId,
      createdAt: isFirestoreTimestampValue(actorRaw?.createdAt)
        ? actorRaw.createdAt
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (
      resolvedAuthUid &&
      resolvedAuthUid !== keptAdminUid &&
      resolvedAuthUid !== auth.currentUser?.uid
    ) {
      await upsertAuthBinding({
        authUid: resolvedAuthUid,
        userId: keptAdminUid,
        departmentId: spaceId,
        isActive: true,
      });
    }

    const keptPrivRef = doc(db, 'users', keptAdminUid, 'private', 'info');
    if (adminPayload.email) {
      const encryptedPrivate = await encryptPrivateData(spaceKey, { email: adminPayload.email });
      await setDoc(keptPrivRef, {
        uid: keptAdminUid,
        encryptedPrivate,
        updatedAt: serverTimestamp(),
      });
    } else {
      const keptPrivSnap = await getDocFromServer(keptPrivRef);
      if (keptPrivSnap.exists()) {
        await deleteDoc(keptPrivRef);
      }
    }

    const normalizedAdmin: UserProfile = {
      uid: keptAdminUid,
      authUid: resolvedAuthUid,
      encryptedAccount,
      mustChangePassword: Boolean(actorRaw?.mustChangePassword),
      username: adminPayload.username,
      employeeCode: adminPayload.employeeCode,
      fullName: adminPayload.fullName,
      title: adminPayload.title,
      email: adminPayload.email,
      roles: normalizedRoles,
      groupId: '',
      managerId: '',
      isActive: true,
      departmentId: spaceId,
    };

    currentStep = 'audit_log';
    await logSystemAudit({
      actor: normalizedAdmin,
      action: 'Xóa toàn bộ dữ liệu',
      targetType: 'system',
      targetId: spaceId,
      detail: `Đã xóa toàn bộ ${deletedDocs} bản ghi dữ liệu và tất cả tài khoản khác, chỉ giữ lại duy nhất tài khoản Quản trị hệ thống (@${adminPayload.username})`,
      allUsers: [normalizedAdmin],
    });

    return { deletedDocs, normalizedAdmin };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${spaceId}/wipeAll/${currentStep}`);
  }
}

export async function fetchUserEmailForAdmin(userId: string): Promise<string> {
  try {
    const [snap, spaceKey] = await Promise.all([
      getDoc(doc(db, 'users', userId, 'private', 'info')),
      getSpaceAesKey(getActiveSpaceId()),
    ]);
    if (snap.exists()) {
      return decryptPrivateEmail(snap.data() as Record<string, unknown>, spaceKey);
    }
    return '';
  } catch {
    return '';
  }
}

export function getTodayWorkDateVN(): { dateStr: string; dateNum: number } {
  const { dateStr, dateNum } = getVietnamNowParts();
  return { dateStr, dateNum };
}

export interface GoogleDbAdminUser {
  uid: string;
  email: string;
  displayName: string;
}

export async function signInGoogleForDbAdmin(): Promise<GoogleDbAdminUser> {
  const result = await signInWithPopup(auth, googleProvider);
  const email = (result.user.email || '').trim().toLowerCase();
  if (!email) {
    await signOut(auth);
    throw new Error('Không lấy được địa chỉ Gmail từ tài khoản Google vừa đăng nhập.');
  }
  return {
    uid: result.user.uid,
    email,
    displayName: result.user.displayName || email,
  };
}

export async function signOutGoogleForDbAdmin(): Promise<void> {
  await logoutSession();
}

export async function deduplicateDuplicateUsersBySuperAdmin(params: {
  username: string;
  duplicateUsers: UserProfile[];
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<{ survivor: UserProfile; removedCount: number }> {
  const { username, duplicateUsers, actor, allUsers } = params;
  if (duplicateUsers.length < 2) {
    throw new Error('Không có bản ghi trùng lặp để xử lý.');
  }

  const spaceId = getActiveSpaceId();
  const defaultAdminUid = getDefaultAdminUid();
  const spaceKey = await getOrInitSpaceAesKey(spaceId);

  // Keep canonical usr_mbfs_admin when present (required by firestore.rules),
  // otherwise keep current actor or first user with authUid.
  const survivorBase =
    duplicateUsers.find((u) => u.uid === defaultAdminUid) ||
    duplicateUsers.find((u) => u.uid === actor.uid) ||
    duplicateUsers.find((u) => Boolean(u.authUid)) ||
    duplicateUsers[0];

  const duplicates = duplicateUsers.filter((u) => u.uid !== survivorBase.uid);
  const richerSource =
    duplicateUsers.find((u) => u.uid === actor.uid) ||
    duplicateUsers.find((u) => u.uid !== survivorBase.uid && (u.roles.length > survivorBase.roles.length || Boolean(u.groupId))) ||
    survivorBase;

  const mergedRoles = Array.from(
    new Set<RoleCode>([...survivorBase.roles, ...duplicateUsers.flatMap((u) => u.roles)])
  );
  const resolvedAuthUid =
    survivorBase.authUid || duplicateUsers.find((u) => Boolean(u.authUid))?.authUid || '';
  const mergedGroupId = survivorBase.groupId || richerSource.groupId || '';
  const mergedManagerIdRaw = survivorBase.managerId || richerSource.managerId || '';
  const mergedManagerId = duplicates.some((d) => d.uid === mergedManagerIdRaw)
    ? survivorBase.uid
    : mergedManagerIdRaw;
  const mergedEmail =
    survivorBase.email ||
    duplicateUsers.find((u) => Boolean(u.email))?.email ||
    (await fetchUserEmailForAdmin(richerSource.uid)) ||
    '';

  const payload: EncryptedAccountPayload = {
    username: normalizeUsername(survivorBase.username || username),
    employeeCode: survivorBase.employeeCode || richerSource.employeeCode || 'AD-01',
    fullName: survivorBase.fullName || richerSource.fullName || 'Nhân sự',
    title: survivorBase.title || richerSource.title || '',
    email: mergedEmail,
  };
  const encryptedAccount = await encryptAccountData(spaceKey, payload);

  try {
    const survivorRef = doc(db, 'users', survivorBase.uid);
    const survivorSnap = await getDocFromServer(survivorRef);
    const survivorRaw = survivorSnap.exists()
      ? (survivorSnap.data() as Record<string, unknown>)
      : null;

    await setDoc(survivorRef, {
      uid: survivorBase.uid,
      authUid: resolvedAuthUid,
      encryptedAccount,
      mustChangePassword: Boolean(survivorRaw?.mustChangePassword),
      roles: mergedRoles,
      groupId: mergedGroupId,
      managerId: mergedManagerId,
      isActive: true,
      departmentId: spaceId,
      createdAt: survivorRaw?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (resolvedAuthUid) {
      const bindingRef = doc(db, 'authBindings', resolvedAuthUid);
      const bindingSnap = await getDocFromServer(bindingRef);
      if (bindingSnap.exists()) {
        const bData = bindingSnap.data() as AuthBinding;
        if (bData.userId !== survivorBase.uid) {
          await deleteDoc(bindingRef);
          await setDoc(bindingRef, {
            authUid: resolvedAuthUid,
            userId: survivorBase.uid,
            departmentId: spaceId,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        await setDoc(bindingRef, {
          authUid: resolvedAuthUid,
          userId: survivorBase.uid,
          departmentId: spaceId,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (mergedEmail) {
      const encryptedPrivate = await encryptPrivateData(spaceKey, { email: mergedEmail });
      await setDoc(doc(db, 'users', survivorBase.uid, 'private', 'info'), {
        uid: survivorBase.uid,
        encryptedPrivate,
        updatedAt: serverTimestamp(),
      });
    }

    let removedCount = 0;
    for (const dup of duplicates) {
      if (dup.authUid && dup.authUid !== resolvedAuthUid) {
        const dupBindingRef = doc(db, 'authBindings', dup.authUid);
        const dupBindingSnap = await getDocFromServer(dupBindingRef);
        if (dupBindingSnap.exists() && dupBindingSnap.data()?.userId === dup.uid) {
          await deleteDoc(dupBindingRef);
        }
      }
      const privRef = doc(db, 'users', dup.uid, 'private', 'info');
      const privSnap = await getDocFromServer(privRef);
      if (privSnap.exists()) {
        await deleteDoc(privRef);
      }
      await deleteDoc(doc(db, 'users', dup.uid));
      removedCount += 1;
    }

    const survivor: UserProfile = {
      ...survivorBase,
      authUid: resolvedAuthUid,
      encryptedAccount,
      username: payload.username,
      employeeCode: payload.employeeCode,
      fullName: payload.fullName,
      title: payload.title,
      email: payload.email,
      roles: mergedRoles,
      groupId: mergedGroupId,
      managerId: mergedManagerId,
      isActive: true,
      departmentId: spaceId,
    };

    const nextAllUsers = [
      survivor,
      ...allUsers.filter((u) => !duplicateUsers.some((d) => d.uid === u.uid)),
    ];

    await logSystemAudit({
      actor: survivor,
      action: 'Gộp tài khoản trùng lặp',
      targetType: 'user',
      targetId: survivor.uid,
      detail: `Đã gộp & xóa ${removedCount} bản ghi trùng của tài khoản @${payload.username} (giữ lại ID chuẩn ${survivor.uid})`,
      allUsers: nextAllUsers,
    });

    return { survivor, removedCount };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/deduplicate/${username}`);
  }
}


