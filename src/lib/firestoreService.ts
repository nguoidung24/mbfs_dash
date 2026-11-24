import {
  collection,
  doc,
  getDoc,
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
  AuthCredential,
  DEFAULT_ADMIN_USERNAME,
  DEPARTMENT_ID,
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
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from './cryptoAuth';
import { db, handleFirestoreError, OperationType } from './firebase';
import { buildParticipantIds } from './rbac';
import { dateStrToNum, getVietnamNowParts } from './time';

const SESSION_STORAGE_KEY = 'dama2_session';

export interface StoredSession {
  userId: string;
  username: string;
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

export function saveSession(session: StoredSession): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function logoutSession(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
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
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    const username = normalizeUsername(parsed.username || '');
    const userId = (parsed.userId || '').trim();
    if (!username || !userId || !isValidUsernameFormat(username)) {
      logoutSession();
      return null;
    }

    const [credSnap, userSnap] = await Promise.all([
      getDoc(doc(db, 'authCredentials', username)),
      getDoc(doc(db, 'users', userId)),
    ]);

    if (!credSnap.exists() || !userSnap.exists()) {
      logoutSession();
      return null;
    }

    const cred = credSnap.data() as AuthCredential;
    const user = userSnap.data() as UserProfile;

    if (!cred.isActive || !user.isActive || cred.userId !== user.uid) {
      logoutSession();
      return null;
    }

    return {
      user: { ...user, username },
      mustChangePassword: Boolean(cred.mustChangePassword),
    };
  } catch {
    logoutSession();
    return null;
  }
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

  const credRef = doc(db, 'authCredentials', username);
  let credSnap;
  try {
    credSnap = await getDoc(credRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `authCredentials/${username}`);
  }

  // Bootstrap default admin mbfs_admin on first login (ADMIN role only, NOT Trưởng phòng)
  if (!credSnap.exists()) {
    if (username !== DEFAULT_ADMIN_USERNAME) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
    }

    const matchesBootstrap = await verifyPassword(
      password,
      DEFAULT_ADMIN_BOOTSTRAP_HASH
    );
    if (!matchesBootstrap) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không đúng.');
    }

    const adminUid = 'usr_mbfs_admin';
    const userRef = doc(db, 'users', adminUid);
    const existingAdminUser = await getDoc(userRef);

    const adminProfile: UserProfile = existingAdminUser.exists()
      ? ({ ...(existingAdminUser.data() as UserProfile), username } as UserProfile)
      : {
          uid: adminUid,
          username,
          employeeCode: 'AD-01',
          fullName: 'Quản trị hệ thống',
          title: 'Quản trị hệ thống',
          roles: ['ADMIN'],
          groupId: '',
          managerId: '',
          isActive: true,
          departmentId: DEPARTMENT_ID,
        };

    try {
      if (!existingAdminUser.exists()) {
        await setDoc(userRef, {
          ...adminProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (existingAdminUser.data()?.username !== username) {
        await updateDoc(userRef, {
          username,
          updatedAt: serverTimestamp(),
        });
      }

      await setDoc(credRef, {
        username,
        userId: adminUid,
        passwordHash: DEFAULT_ADMIN_BOOTSTRAP_HASH,
        mustChangePassword: true,
        isActive: true,
        failedAttempts: 0,
        lockedUntil: 0,
        departmentId: DEPARTMENT_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `authCredentials/${username}`);
    }

    saveSession({ userId: adminUid, username });
    return {
      user: adminProfile,
      mustChangePassword: true,
    };
  }

  const cred = credSnap.data() as AuthCredential;

  if (!cred.isActive) {
    throw new Error('Tài khoản đang bị tạm khóa. Vui lòng liên hệ Quản trị viên phòng ban.');
  }

  if (cred.lockedUntil && cred.lockedUntil > Date.now()) {
    const minutesLeft = Math.max(1, Math.ceil((cred.lockedUntil - Date.now()) / 60000));
    throw new Error(
      `Tài khoản tạm thời bị khóa do nhập sai mật khẩu nhiều lần. Vui lòng thử lại sau ${minutesLeft} phút.`
    );
  }

  const isPasswordValid = await verifyPassword(password, cred.passwordHash);
  if (!isPasswordValid) {
    const nextAttempts = (cred.failedAttempts || 0) + 1;
    const shouldLock = nextAttempts >= 5;
    try {
      await updateDoc(credRef, {
        failedAttempts: shouldLock ? 0 : nextAttempts,
        lockedUntil: shouldLock ? Date.now() + 5 * 60 * 1000 : 0,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal
    }
    if (shouldLock) {
      throw new Error(
        'Bạn đã nhập sai mật khẩu 5 lần liên tiếp. Tài khoản tạm khóa trong 5 phút.'
      );
    }
    throw new Error(
      `Tên đăng nhập hoặc mật khẩu không đúng (còn ${5 - nextAttempts} lần thử).`
    );
  }

  const userSnap = await getDoc(doc(db, 'users', cred.userId));
  if (!userSnap.exists()) {
    throw new Error('Không tìm thấy hồ sơ nhân sự cho tài khoản này.');
  }
  const user = userSnap.data() as UserProfile;
  if (!user.isActive) {
    throw new Error('Tài khoản nhân sự hiện đang bị khóa. Vui lòng liên hệ Quản trị viên.');
  }

  if ((cred.failedAttempts || 0) > 0 || (cred.lockedUntil || 0) > 0) {
    try {
      await updateDoc(credRef, {
        failedAttempts: 0,
        lockedUntil: 0,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal
    }
  }

  saveSession({ userId: user.uid, username });
  return {
    user: { ...user, username },
    mustChangePassword: Boolean(cred.mustChangePassword),
  };
}

export async function changeOwnPassword(params: {
  username: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const username = normalizeUsername(params.username);
  if (!isValidUsernameFormat(username)) {
    throw new Error('Không xác định được tài khoản đang đăng nhập.');
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

  const credRef = doc(db, 'authCredentials', username);
  const credSnap = await getDoc(credRef);
  if (!credSnap.exists()) {
    throw new Error('Không tìm thấy thông tin xác thực của tài khoản.');
  }

  const cred = credSnap.data() as AuthCredential;
  if (!cred.isActive) {
    throw new Error('Tài khoản đang bị khóa, không thể đổi mật khẩu.');
  }

  const validCurrent = await verifyPassword(params.currentPassword, cred.passwordHash);
  if (!validCurrent) {
    throw new Error('Mật khẩu hiện tại không chính xác.');
  }

  const newHash = await hashPassword(params.newPassword);
  try {
    await updateDoc(credRef, {
      passwordHash: newHash,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: 0,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `authCredentials/${username}`);
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
      departmentId: DEPARTMENT_ID,
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
        departmentId: DEPARTMENT_ID,
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
          departmentId: DEPARTMENT_ID,
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
      departmentId: DEPARTMENT_ID,
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
        departmentId: DEPARTMENT_ID,
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
        departmentId: DEPARTMENT_ID,
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
      departmentId: DEPARTMENT_ID,
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

  if (!existing) {
    if (!username) {
      throw new Error('Vui lòng nhập tên đăng nhập cho tài khoản mới.');
    }
    const existingCredSnap = await getDoc(doc(db, 'authCredentials', username));
    if (existingCredSnap.exists()) {
      throw new Error(`Tên đăng nhập "${username}" đã tồn tại. Vui lòng chọn tên khác.`);
    }
    const pwd = input.initialPassword || '';
    const strengthErr = validatePasswordStrength(pwd);
    if (strengthErr) {
      throw new Error(`Mật khẩu khởi tạo không đạt yêu cầu: ${strengthErr}`);
    }
  }

  try {
    if (existing) {
      await updateDoc(doc(db, 'users', uid), {
        ...(username ? { username } : {}),
        employeeCode: input.employeeCode.trim().slice(0, 32),
        fullName: input.fullName.trim().slice(0, 120),
        title: input.title.trim().slice(0, 120),
        roles: input.roles,
        groupId: input.groupId,
        managerId: input.managerId,
        isActive: existing.uid === actor.uid ? true : input.isActive,
        updatedAt: serverTimestamp(),
      });

      if (username && existing.uid !== actor.uid) {
        const credSnap = await getDoc(doc(db, 'authCredentials', username));
        if (credSnap.exists()) {
          await updateDoc(doc(db, 'authCredentials', username), {
            isActive: input.isActive,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } else {
      await setDoc(doc(db, 'users', uid), {
        uid,
        username,
        employeeCode: input.employeeCode.trim().slice(0, 32),
        fullName: input.fullName.trim().slice(0, 120),
        title: input.title.trim().slice(0, 120),
        roles: input.roles,
        groupId: input.groupId,
        managerId: input.managerId,
        isActive: input.isActive,
        departmentId: DEPARTMENT_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const passwordHash = await hashPassword(input.initialPassword!);
      await setDoc(doc(db, 'authCredentials', username), {
        username,
        userId: uid,
        passwordHash,
        mustChangePassword: true,
        isActive: input.isActive,
        failedAttempts: 0,
        lockedUntil: 0,
        departmentId: DEPARTMENT_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (emailLower) {
      await setDoc(doc(db, 'users', uid, 'private', 'info'), {
        uid,
        email: emailLower,
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
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function toggleUserLockByAdmin(params: {
  targetUser: UserProfile;
  nextActive: boolean;
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { targetUser, nextActive, actor, allUsers } = params;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', targetUser.uid), {
      isActive: nextActive,
      updatedAt: serverTimestamp(),
    });
    if (targetUser.username) {
      const credSnap = await getDoc(doc(db, 'authCredentials', targetUser.username));
      if (credSnap.exists()) {
        batch.update(doc(db, 'authCredentials', targetUser.username), {
          isActive: nextActive,
          updatedAt: serverTimestamp(),
        });
      }
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

export async function resetUserPasswordByAdmin(params: {
  targetUser: UserProfile;
  usernameInput?: string;
  newPassword: string;
  requireChangeOnNextLogin: boolean;
  actor: UserProfile;
  allUsers: UserProfile[];
}): Promise<void> {
  const { targetUser, usernameInput, newPassword, requireChangeOnNextLogin, actor, allUsers } =
    params;

  const username = normalizeUsername(targetUser.username || usernameInput || '');
  if (!isValidUsernameFormat(username)) {
    throw new Error(
      'Tên đăng nhập không hợp lệ (2–64 ký tự gồm a-z, 0-9, dấu chấm, gạch dưới hoặc gạch ngang).'
    );
  }
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    throw new Error(strengthError);
  }

  const passwordHash = await hashPassword(newPassword);
  const credRef = doc(db, 'authCredentials', username);
  const credSnap = await getDoc(credRef);

  try {
    if (!targetUser.username) {
      await updateDoc(doc(db, 'users', targetUser.uid), {
        username,
        updatedAt: serverTimestamp(),
      });
    }

    if (credSnap.exists()) {
      await updateDoc(credRef, {
        passwordHash,
        mustChangePassword: requireChangeOnNextLogin,
        failedAttempts: 0,
        lockedUntil: 0,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(credRef, {
        username,
        userId: targetUser.uid,
        passwordHash,
        mustChangePassword: requireChangeOnNextLogin,
        isActive: targetUser.isActive,
        failedAttempts: 0,
        lockedUntil: 0,
        departmentId: DEPARTMENT_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await logSystemAudit({
      actor,
      action: 'Đặt lại mật khẩu',
      targetType: 'user',
      targetId: targetUser.uid,
      detail: `Đặt lại mật khẩu cho ${targetUser.fullName} (@${username})${requireChangeOnNextLogin ? ' · Bắt buộc đổi MK lần sau' : ''}`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `authCredentials/${username}`);
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
      departmentId: DEPARTMENT_ID,
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
  try {
    await setDoc(doc(db, 'systemConfigs', 'department'), {
      lockHour: Number(config.lockHour),
      lockMinute: Number(config.lockMinute),
      reminderHour: Number(config.reminderHour),
      reminderMinute: Number(config.reminderMinute),
      timezone: 'Asia/Ho_Chi_Minh',
      defaultLabels: config.defaultLabels.slice(0, 30),
      holidays: (config.holidays || []).slice(0, 50),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    await logSystemAudit({
      actor,
      action: 'Cập nhật cấu hình hệ thống',
      targetType: 'systemConfig',
      targetId: 'department',
      detail: `Giờ khóa ngày: ${config.lockHour}:${String(config.lockMinute).padStart(2, '0')} UTC+7`,
      allUsers,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'systemConfigs/department');
  }
}

export async function wipeAllDepartmentData(actor: UserProfile): Promise<{
  deletedDocs: number;
  normalizedAdmin: UserProfile;
}> {
  let deletedDocs = 0;

  try {
    // 1. Delete tasks and their subcollections (subtasks, comments, auditLogs)
    const tasksSnap = await getDocs(
      query(collection(db, 'tasks'), where('departmentId', '==', DEPARTMENT_ID))
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

    // 2. Delete workLogs (tasks are now gone so rule allows cleanup) & workLogUnlocks
    const [wlSnap, ulSnap] = await Promise.all([
      getDocs(query(collection(db, 'workLogs'), where('departmentId', '==', DEPARTMENT_ID))),
      getDocs(
        query(collection(db, 'workLogUnlocks'), where('departmentId', '==', DEPARTMENT_ID))
      ),
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
      query(collection(db, 'projects'), where('departmentId', '==', DEPARTMENT_ID))
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

    // 4. Delete groups, system auditLogs, and systemConfigs/department
    const [grpSnap, audSnap, cfgSnap] = await Promise.all([
      getDocs(query(collection(db, 'groups'), where('departmentId', '==', DEPARTMENT_ID))),
      getDocs(query(collection(db, 'auditLogs'), where('departmentId', '==', DEPARTMENT_ID))),
      getDoc(doc(db, 'systemConfigs', 'department')),
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

    // 5. Delete all non-admin users, their private info, and their authCredentials
    const usersSnap = await getDocs(
      query(collection(db, 'users'), where('departmentId', '==', DEPARTMENT_ID))
    );
    const userOps: Array<(b: WriteBatch) => void> = [];
    for (const uDoc of usersSnap.docs) {
      const uData = uDoc.data() as UserProfile;
      if (uDoc.id === actor.uid || uDoc.id === 'usr_mbfs_admin') {
        continue;
      }
      if (uData.username && uData.username !== DEFAULT_ADMIN_USERNAME) {
        userOps.push((b) => b.delete(doc(db, 'authCredentials', uData.username!)));
        deletedDocs += 1;
      }
      userOps.push((b) => b.delete(doc(db, 'users', uDoc.id, 'private', 'info')));
      userOps.push((b) => b.delete(uDoc.ref));
      deletedDocs += 1;
    }
    if (userOps.length > 0) await runBatchOps(userOps);

    // 6. Normalize kept Admin account as pure ADMIN (not Trưởng phòng)
    const normalizedRoles: RoleCode[] = ['ADMIN'];
    await updateDoc(doc(db, 'users', actor.uid), {
      title: 'Quản trị hệ thống',
      roles: normalizedRoles,
      groupId: '',
      managerId: '',
      isActive: true,
      updatedAt: serverTimestamp(),
    });

    const normalizedAdmin: UserProfile = {
      ...actor,
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
      targetId: DEPARTMENT_ID,
      detail: `Đã xóa toàn bộ ${deletedDocs} bản ghi dữ liệu, chỉ giữ lại tài khoản Quản trị hệ thống (@${actor.username || DEFAULT_ADMIN_USERNAME})`,
      allUsers: [normalizedAdmin],
    });

    return { deletedDocs, normalizedAdmin };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'department/wipeAll');
  }
}

export async function fetchUserEmailForAdmin(userId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'private', 'info'));
    if (snap.exists()) {
      return (snap.data() as { email?: string }).email || '';
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
