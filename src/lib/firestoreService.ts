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
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
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
import { buildParticipantIds } from './rbac';
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
  ops: Array<(batch: WriteBatch) => void>
): Promise<void> {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
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
      actorName: params.actor.fullName,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      detail: params.detail.slice(0, 1000),
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
  const leadershipIds = allUsers
    .filter(
      (u) =>
        u.roles.includes('ADMIN') ||
        u.roles.includes('TRUONG_PHONG') ||
        u.roles.includes('PHO_PHONG')
    )
    .map((u) => u.uid);

  const memberIds = Array.from(
    new Set([input.pmId, actor.uid, ...input.memberIds, ...leadershipIds])
  ).slice(0, 50);

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
        pmId: input.pmId,
        memberIds,
        labels: input.labels.slice(0, 15),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, 'projects', id), {
        id,
        code: input.code.trim().toUpperCase().slice(0, 32),
        name: input.name.trim().slice(0, 160),
        description: input.description.trim().slice(0, 2000),
        startDate: input.startDate,
        expectedEndDate: input.expectedEndDate,
        status: input.status,
        pmId: input.pmId,
        memberIds,
        labels: input.labels.slice(0, 15),
        createdBy: actor.uid,
        departmentId: getActiveSpaceId(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const uid of memberIds) {
      batch.set(doc(db, 'projects', id, 'members', uid), {
        userId: uid,
        projectRole: uid === input.pmId ? 'QUAN_LY_DU_AN' : 'THANH_VIEN',
        joinedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    await logSystemAudit({
      actor,
      action: existing ? 'Cập nhật dự án' : 'Tạo dự án',
      targetType: 'project',
      targetId: id,
      detail: `${existing ? 'Cập nhật' : 'Tạo mới'} dự án ${input.code.toUpperCase()} - ${input.name}`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${id}`);
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
    } catch (err) {
      const code = getAuthErrorCode(err);
      if (code === 'auth/email-already-in-use') {
        throw new Error(
          `Tên đăng nhập "${username}" đã tồn tại trên hệ thống xác thực Firebase Auth.`
        );
      }
      if (code === 'auth/operation-not-allowed') {
        throw new Error(
          'Phương thức Email/Password chưa được bật trong Firebase Authentication.'
        );
      }
      throw new Error(
        err instanceof Error ? err.message : 'Không thể khởi tạo tài khoản Firebase Auth.'
      );
    }
  }

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
        roles: input.roles,
        groupId: input.groupId,
        managerId: input.managerId,
        isActive: resolvedActive,
        departmentId: spaceId,
        createdAt: existingRaw?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (provisionedAuthUser) {
        await setDoc(doc(db, 'authBindings', resolvedAuthUid), {
          authUid: resolvedAuthUid,
          userId: uid,
          departmentId: spaceId,
          isActive: resolvedActive,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (existing.uid !== actor.uid && resolvedAuthUid) {
        const bindingRef = doc(db, 'authBindings', resolvedAuthUid);
        const bindingSnap = await getDocFromServer(bindingRef);
        if (bindingSnap.exists()) {
          await updateDoc(bindingRef, {
            isActive: resolvedActive,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } else {
      await setDoc(doc(db, 'users', uid), {
        uid,
        authUid: resolvedAuthUid,
        encryptedAccount,
        mustChangePassword: true,
        roles: input.roles,
        groupId: input.groupId,
        managerId: input.managerId,
        isActive: resolvedActive,
        departmentId: spaceId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'authBindings', resolvedAuthUid), {
        authUid: resolvedAuthUid,
        userId: uid,
        departmentId: spaceId,
        isActive: resolvedActive,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (emailLower) {
      const encryptedPrivate = await encryptPrivateData(spaceKey, { email: emailLower });
      await setDoc(doc(db, 'users', uid, 'private', 'info'), {
        uid,
        encryptedPrivate,
        updatedAt: serverTimestamp(),
      });
    }

    await logSystemAudit({
      actor,
      action: existing ? 'Cập nhật nhân sự' : 'Tạo nhân sự mới',
      targetType: 'user',
      targetId: uid,
      detail: `${existing ? 'Cập nhật' : 'Tạo mới'} ${input.fullName} (${input.employeeCode}, @${username || 'chưa gắn TK'}) - Vai trò: ${input.roles.join(', ')}`,
      allUsers,
    });
  } catch (error) {
    if (provisionedAuthUser) {
      try {
        await deleteUser(provisionedAuthUser);
      } catch {
        // ignore rollback error
      }
    }
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
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', targetUser.uid), {
      isActive: nextActive,
      updatedAt: serverTimestamp(),
    });
    const bindingRef = doc(db, 'authBindings', targetUser.authUid);
    const bindingSnap = await getDocFromServer(bindingRef);
    if (bindingSnap.exists()) {
      batch.update(bindingRef, {
        isActive: nextActive,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

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
      employeeCode: targetUser.employeeCode,
      fullName: targetUser.fullName,
      title: targetUser.title || '',
      email,
    });

    await setDoc(doc(db, 'users', targetUser.uid), {
      uid: targetUser.uid,
      authUid: provisionedUser.uid,
      encryptedAccount,
      mustChangePassword: requireChangeOnNextLogin,
      roles: targetUser.roles,
      groupId: targetUser.groupId || '',
      managerId: targetUser.managerId || '',
      isActive: targetUser.isActive,
      departmentId: spaceId,
      createdAt: existingRaw?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'authBindings', provisionedUser.uid), {
      authUid: provisionedUser.uid,
      userId: targetUser.uid,
      departmentId: spaceId,
      isActive: targetUser.isActive,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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

  try {
    // 1. Delete tasks and their subcollections (subtasks, comments, auditLogs)
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

    if (subDeleteOps.length > 0) await runBatchOps(subDeleteOps);
    if (taskDeleteOps.length > 0) await runBatchOps(taskDeleteOps);

    // 2. Delete workLogs & workLogUnlocks
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
    if (prjMemberOps.length > 0) await runBatchOps(prjMemberOps);
    if (prjDeleteOps.length > 0) await runBatchOps(prjDeleteOps);

    // 4. Delete groups, system auditLogs, and systemConfigs
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

    // 5. Delete non-admin users' private info & authBindings BEFORE user docs
    const usersSnap = await getDocs(
      query(collection(db, 'users'), where('departmentId', '==', spaceId))
    );
    const bindingAndPrivateOps: Array<(b: WriteBatch) => void> = [];
    const userDeleteOps: Array<(b: WriteBatch) => void> = [];
    for (const uDoc of usersSnap.docs) {
      const uData = uDoc.data() as Record<string, unknown>;
      if (uDoc.id === actor.uid || uDoc.id === defaultAdminUid) {
        continue;
      }
      if (typeof uData.authUid === 'string' && uData.authUid) {
        const bUid = uData.authUid;
        bindingAndPrivateOps.push((b) => b.delete(doc(db, 'authBindings', bUid)));
        deletedDocs += 1;
      }
      bindingAndPrivateOps.push((b) => b.delete(doc(db, 'users', uDoc.id, 'private', 'info')));
      userDeleteOps.push((b) => b.delete(uDoc.ref));
      deletedDocs += 1;
    }
    if (bindingAndPrivateOps.length > 0) await runBatchOps(bindingAndPrivateOps);
    if (userDeleteOps.length > 0) await runBatchOps(userDeleteOps);

    // 6. Normalize kept Admin account as pure ADMIN (encrypted)
    const spaceKey = await getOrInitSpaceAesKey(spaceId);
    const actorSnap = await getDocFromServer(doc(db, 'users', actor.uid));
    const actorRaw = actorSnap.exists() ? (actorSnap.data() as Record<string, unknown>) : null;
    const resolvedAuthUid =
      (actorRaw && typeof actorRaw.authUid === 'string' && actorRaw.authUid) ||
      actor.authUid ||
      '';
    const normalizedRoles: RoleCode[] = ['ADMIN'];
    const adminPayload: EncryptedAccountPayload = {
      username: actor.username || DEFAULT_ADMIN_USERNAME,
      employeeCode: actor.employeeCode || 'AD-01',
      fullName: actor.fullName || 'Quản trị hệ thống',
      title: 'Quản trị hệ thống',
      email: actor.email || '',
    };
    const encryptedAccount = await encryptAccountData(spaceKey, adminPayload);

    await setDoc(doc(db, 'users', actor.uid), {
      uid: actor.uid,
      authUid: resolvedAuthUid,
      encryptedAccount,
      mustChangePassword: Boolean(actorRaw?.mustChangePassword),
      roles: normalizedRoles,
      groupId: '',
      managerId: '',
      isActive: true,
      departmentId: spaceId,
      createdAt: actorRaw?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const normalizedAdmin: UserProfile = {
      ...actor,
      authUid: resolvedAuthUid,
      encryptedAccount,
      title: 'Quản trị hệ thống',
      roles: normalizedRoles,
      groupId: '',
      managerId: '',
      isActive: true,
    };

    await logSystemAudit({
      actor: normalizedAdmin,
      action: 'Xóa toàn bộ dữ liệu',
      targetType: 'system',
      targetId: spaceId,
      detail: `Đã xóa toàn bộ ${deletedDocs} bản ghi dữ liệu, chỉ giữ lại tài khoản Quản trị hệ thống (@${adminPayload.username})`,
      allUsers: [normalizedAdmin],
    });

    return { deletedDocs, normalizedAdmin };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${spaceId}/wipeAll`);
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

