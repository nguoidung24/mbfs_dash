import * as XLSX from 'xlsx';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  where,
  WriteBatch,
} from 'firebase/firestore';
import {
  DEFAULT_ADMIN_USERNAME,
  Project,
  ProjectStatus,
  ReviewResult,
  RoleCode,
  SubmissionStatus,
  SystemAuditLog,
  SystemConfig,
  TaskComment,
  TaskItem,
  TaskPriority,
  TaskStatus,
  TaskSubtask,
  UserProfile,
  WorkGroup,
  WorkLog,
  WorkLogUnlock,
} from '../types/domain';
import { validatePasswordStrength } from './cryptoAuth';
import {
  db,
  getActiveSpaceId,
  getInternalAuthEmail,
  getSystemConfigDocId,
  handleFirestoreError,
  OperationType,
  provisionerAuth,
} from './firebase';
import {
  decodeUserProfiles,
  decryptPrivateEmail,
  encryptAccountData,
  encryptPrivateData,
  getOrInitSpaceAesKey,
  getSpaceAesKey,
  isValidUsernameFormat,
  logSystemAudit,
  normalizeUsername,
  runBatchOps,
} from './firestoreService';
import { dateStrToNum, getVietnamNowParts } from './time';

const VALID_ROLES: RoleCode[] = [
  'ADMIN',
  'TRUONG_PHONG',
  'PHO_PHONG',
  'QUAN_LY_DU_AN',
  'TRUONG_NHOM',
  'CHUYEN_VIEN',
];

const VALID_PROJECT_STATUSES: ProjectStatus[] = [
  'CHUAN_BI',
  'DANG_THUC_HIEN',
  'TAM_DUNG',
  'HOAN_THANH',
  'DONG',
];

const VALID_PRIORITIES: TaskPriority[] = ['THAP', 'TRUNG_BINH', 'CAO', 'KHAN_CAP'];

const VALID_TASK_STATUSES: TaskStatus[] = [
  'MOI',
  'DANG_THUC_HIEN',
  'CHO_XAC_NHAN',
  'CHUA_HOAN_THANH',
  'HOAN_THANH',
  'TAM_HOAN',
  'HUY',
];

const VALID_SUBMISSION_STATUSES: SubmissionStatus[] = ['CHUA_NOP', 'DA_NOP'];
const VALID_REVIEW_RESULTS: ReviewResult[] = [
  'CHO_XAC_NHAN',
  'DA_HOAN_THANH',
  'CHUA_HOAN_THANH',
];

function splitList(val: unknown): string[] {
  if (typeof val !== 'string') return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(val: unknown, fallback = false): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (['true', '1', 'có', 'co', 'yes', 'x'].includes(s)) return true;
    if (['false', '0', 'không', 'khong', 'no', ''].includes(s)) return false;
  }
  return fallback;
}

function str(val: unknown, maxLen = 5000): string {
  if (val === undefined || val === null) return '';
  return String(val).trim().slice(0, maxLen);
}

function sanitizeDocId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleaned.length >= 1 && cleaned.length <= 128) return cleaned;
  return `${fallbackPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function scopeIdForSpace(raw: string, fallbackPrefix: string, spaceId: string): string {
  const cleaned = sanitizeDocId(raw, fallbackPrefix);
  if (spaceId === 'DAMA2') return cleaned;
  const stripped = cleaned.replace(/^DB_[a-zA-Z0-9_-]+__/, '');
  return `${spaceId}__${stripped}`.slice(0, 128);
}

export async function exportDatabaseToExcel(actor: UserProfile): Promise<void> {
  const spaceId = getActiveSpaceId();
  const cfgId = getSystemConfigDocId();
  try {
    const [
      usersSnap,
      groupsSnap,
      projectsSnap,
      tasksSnap,
      workLogsSnap,
      unlocksSnap,
      configSnap,
      auditLogsSnap,
    ] = await Promise.all([
      getDocs(query(collection(db, 'users'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'groups'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'projects'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'tasks'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'workLogs'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'workLogUnlocks'), where('departmentId', '==', spaceId))),
      getDoc(doc(db, 'systemConfigs', cfgId)),
      getDocs(query(collection(db, 'auditLogs'), where('departmentId', '==', spaceId))),
    ]);

    const spaceKey = await getSpaceAesKey(spaceId);
    const usersList = await decodeUserProfiles(
      usersSnap.docs.map((d) => d.data() as Record<string, unknown>),
      spaceId
    );

    const userRows = await Promise.all(
      usersList.map(async (u) => {
        let email = u.email || '';
        try {
          const pSnap = await getDoc(doc(db, 'users', u.uid, 'private', 'info'));
          if (pSnap.exists()) {
            const privEmail = await decryptPrivateEmail(
              pSnap.data() as Record<string, unknown>,
              spaceKey
            );
            if (privEmail) email = privEmail;
          }
        } catch {
          // ignore
        }
        return {
          uid: u.uid,
          username: u.username || '',
          employeeCode: u.employeeCode,
          fullName: u.fullName,
          title: u.title || '',
          roles: (u.roles || []).join(', '),
          groupId: u.groupId || '',
          managerId: u.managerId || '',
          isActive: u.isActive,
          email,
          initialPassword: '',
        };
      })
    );

    const groupRows = groupsSnap.docs.map((d) => {
      const g = d.data() as WorkGroup;
      return {
        id: g.id,
        code: g.code,
        name: g.name,
        description: g.description || '',
        leaderId: g.leaderId || '',
        memberUids: (g.memberUids || []).join(', '),
      };
    });

    const projectRows = projectsSnap.docs.map((d) => {
      const p = d.data() as Project;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description || '',
        startDate: p.startDate || '',
        expectedEndDate: p.expectedEndDate || '',
        status: p.status,
        pmId: p.pmId,
        memberIds: (p.memberIds || []).join(', '),
        labels: (p.labels || []).join(', '),
        createdBy: p.createdBy,
      };
    });

    const taskDocs = tasksSnap.docs.map((d) => d.data() as TaskItem);
    const taskRows = taskDocs.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      description: t.description || '',
      projectId: t.projectId || '',
      groupId: t.groupId || '',
      creatorId: t.creatorId,
      assigneeId: t.assigneeId,
      reviewerId: t.reviewerId,
      parentTaskId: t.parentTaskId || '',
      priority: t.priority,
      startDate: t.startDate || '',
      dueDate: t.dueDate || '',
      estimatedHours: t.estimatedHours ?? 0,
      labels: (t.labels || []).join(', '),
      attachments: (t.attachments || []).join(', '),
      status: t.status,
      submissionStatus: t.submissionStatus,
      submissionNote: t.submissionNote || '',
      reviewResult: t.reviewResult,
      reviewNote: t.reviewNote || '',
      isLocked: t.isLocked,
      participantIds: (t.participantIds || []).join(', '),
    }));

    const subtaskRows: Array<{
      taskId: string;
      id: string;
      title: string;
      isDone: boolean;
      createdBy: string;
      taskParticipantIds: string;
    }> = [];
    const commentRows: Array<{
      taskId: string;
      id: string;
      authorId: string;
      authorName: string;
      content: string;
      mentions: string;
      taskParticipantIds: string;
    }> = [];

    await Promise.all(
      taskDocs.map(async (t) => {
        const [subSnap, cmtSnap] = await Promise.all([
          getDocs(collection(db, 'tasks', t.id, 'subtasks')),
          getDocs(collection(db, 'tasks', t.id, 'comments')),
        ]);
        for (const sDoc of subSnap.docs) {
          const s = sDoc.data() as TaskSubtask;
          subtaskRows.push({
            taskId: t.id,
            id: s.id,
            title: s.title,
            isDone: s.isDone,
            createdBy: s.createdBy,
            taskParticipantIds: (s.taskParticipantIds || []).join(', '),
          });
        }
        for (const cDoc of cmtSnap.docs) {
          const c = cDoc.data() as TaskComment;
          commentRows.push({
            taskId: t.id,
            id: c.id,
            authorId: c.authorId,
            authorName: c.authorName,
            content: c.content,
            mentions: (c.mentions || []).join(', '),
            taskParticipantIds: (c.taskParticipantIds || []).join(', '),
          });
        }
      })
    );

    const workLogRows = workLogsSnap.docs.map((d) => {
      const w = d.data() as WorkLog;
      return {
        id: w.id,
        userId: w.userId,
        taskId: w.taskId,
        projectId: w.projectId || '',
        workDate: w.workDate,
        workDateNum: w.workDateNum,
        hours: w.hours,
        progressPercent: w.progressPercent ?? 0,
        note: w.note,
        viewerIds: (w.viewerIds || []).join(', '),
      };
    });

    const unlockRows = unlocksSnap.docs.map((d) => {
      const u = d.data() as WorkLogUnlock;
      return {
        id: u.id,
        userId: u.userId,
        workDate: u.workDate,
        unlockedBy: u.unlockedBy,
        reason: u.reason,
      };
    });

    const cfgData = configSnap.exists() ? (configSnap.data() as SystemConfig) : null;
    const configRows = cfgData
      ? [
          {
            lockHour: cfgData.lockHour,
            lockMinute: cfgData.lockMinute,
            reminderHour: cfgData.reminderHour,
            reminderMinute: cfgData.reminderMinute,
            timezone: cfgData.timezone || 'Asia/Ho_Chi_Minh',
            defaultLabels: (cfgData.defaultLabels || []).join(', '),
            holidays: (cfgData.holidays || []).join(', '),
          },
        ]
      : [];

    const auditRows = auditLogsSnap.docs.map((d) => {
      const a = d.data() as SystemAuditLog;
      return {
        id: a.id,
        actorId: a.actorId,
        actorName: a.actorName,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        detail: a.detail,
        viewerIds: (a.viewerIds || []).join(', '),
      };
    });

    const wb = XLSX.utils.book_new();
    const appendSheet = (name: string, rows: Array<Record<string, unknown>>, headers: string[]) => {
      const ws =
        rows.length > 0
          ? XLSX.utils.json_to_sheet(rows, { header: headers })
          : XLSX.utils.aoa_to_sheet([headers]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    appendSheet('NhanSu', userRows, [
      'uid',
      'username',
      'employeeCode',
      'fullName',
      'title',
      'roles',
      'groupId',
      'managerId',
      'isActive',
      'email',
      'initialPassword',
    ]);
    appendSheet('NhomViec', groupRows, [
      'id',
      'code',
      'name',
      'description',
      'leaderId',
      'memberUids',
    ]);
    appendSheet('DuAn', projectRows, [
      'id',
      'code',
      'name',
      'description',
      'startDate',
      'expectedEndDate',
      'status',
      'pmId',
      'memberIds',
      'labels',
      'createdBy',
    ]);
    appendSheet('CongViec', taskRows, [
      'id',
      'code',
      'title',
      'description',
      'projectId',
      'groupId',
      'creatorId',
      'assigneeId',
      'reviewerId',
      'parentTaskId',
      'priority',
      'startDate',
      'dueDate',
      'estimatedHours',
      'labels',
      'attachments',
      'status',
      'submissionStatus',
      'submissionNote',
      'reviewResult',
      'reviewNote',
      'isLocked',
      'participantIds',
    ]);
    appendSheet('DauViecCon', subtaskRows, [
      'taskId',
      'id',
      'title',
      'isDone',
      'createdBy',
      'taskParticipantIds',
    ]);
    appendSheet('BinhLuan', commentRows, [
      'taskId',
      'id',
      'authorId',
      'authorName',
      'content',
      'mentions',
      'taskParticipantIds',
    ]);
    appendSheet('NhatKyLamViec', workLogRows, [
      'id',
      'userId',
      'taskId',
      'projectId',
      'workDate',
      'workDateNum',
      'hours',
      'progressPercent',
      'note',
      'viewerIds',
    ]);
    appendSheet('MoKhoaLogWork', unlockRows, [
      'id',
      'userId',
      'workDate',
      'unlockedBy',
      'reason',
    ]);
    appendSheet('CauHinh', configRows, [
      'lockHour',
      'lockMinute',
      'reminderHour',
      'reminderMinute',
      'timezone',
      'defaultLabels',
      'holidays',
    ]);
    appendSheet('NhatKyHeThong', auditRows, [
      'id',
      'actorId',
      'actorName',
      'action',
      'targetType',
      'targetId',
      'detail',
      'viewerIds',
    ]);

    const { dateStr, hour, minute } = getVietnamNowParts();
    const fileName = `${spaceId}_CSDL_${dateStr}_${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}.xlsx`;
    XLSX.writeFile(wb, fileName);

    await logSystemAudit({
      actor,
      action: 'Xuất cơ sở dữ liệu Excel',
      targetType: 'system',
      targetId: spaceId,
      detail: `Tải xuống file ${fileName} (${userRows.length} nhân sự, ${projectRows.length} dự án, ${taskRows.length} công việc, ${workLogRows.length} log work)`,
      allUsers: usersList,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'exportDatabaseToExcel');
  }
}

export interface ImportSummary {
  users: number;
  credentials: number;
  skippedUsersNoAuth: number;
  groups: number;
  projects: number;
  tasks: number;
  subtasks: number;
  comments: number;
  workLogs: number;
  skippedLockedTasks: number;
}

export async function importDatabaseFromExcel(
  file: File,
  actor: UserProfile
): Promise<ImportSummary> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  const recognizedSheets = [
    'NhanSu',
    'NhomViec',
    'DuAn',
    'CongViec',
    'DauViecCon',
    'BinhLuan',
    'NhatKyLamViec',
    'MoKhoaLogWork',
    'CauHinh',
  ];
  const hasRecognized = recognizedSheets.some((name) => wb.SheetNames.includes(name));
  if (!hasRecognized) {
    throw new Error(
      'File Excel không đúng định dạng sao lưu của hệ thống (thiếu các sheet NhanSu, NhomViec, DuAn, CongViec...).'
    );
  }

  const readSheet = (name: string): Array<Record<string, unknown>> => {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  };

  const summary: ImportSummary = {
    users: 0,
    credentials: 0,
    skippedUsersNoAuth: 0,
    groups: 0,
    projects: 0,
    tasks: 0,
    subtasks: 0,
    comments: 0,
    workLogs: 0,
    skippedLockedTasks: 0,
  };

  const spaceId = getActiveSpaceId();
  const cfgId = getSystemConfigDocId();
  const spaceKey = await getOrInitSpaceAesKey(spaceId);

  // Preload current state to distinguish create vs update and preserve immutable createdAt
  const [existingUsersSnap, existingGroupsSnap, existingProjectsSnap, existingTasksSnap, existingWlSnap, existingUlSnap] =
    await Promise.all([
      getDocs(query(collection(db, 'users'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'groups'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'projects'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'tasks'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'workLogs'), where('departmentId', '==', spaceId))),
      getDocs(query(collection(db, 'workLogUnlocks'), where('departmentId', '==', spaceId))),
    ]);

  const existingUsersMap = new Map(
    existingUsersSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>])
  );
  const existingGroupIds = new Set(existingGroupsSnap.docs.map((d) => d.id));
  const existingProjectsMap = new Map(existingProjectsSnap.docs.map((d) => [d.id, d.data() as Project]));
  const existingTasksMap = new Map(existingTasksSnap.docs.map((d) => [d.id, d.data() as TaskItem]));
  const existingWlIds = new Set(existingWlSnap.docs.map((d) => d.id));
  const existingUlIds = new Set(existingUlSnap.docs.map((d) => d.id));

  const activeUserIds = new Set<string>(
    existingUsersSnap.docs
      .map((d) => d.data() as Record<string, unknown>)
      .filter((u) => Boolean(u.isActive))
      .map((u) => String(u.uid || ''))
      .filter(Boolean)
  );
  activeUserIds.add(actor.uid);

  const importedUsersList: UserProfile[] = [];

  // 1. NhanSu (Users - encrypted + Firebase Auth provisioned)
  const userRows = readSheet('NhanSu');
  const userOps: Array<(b: WriteBatch) => void> = [];
  const bindingOps: Array<(b: WriteBatch) => void> = [];
  const privateOps: Array<(b: WriteBatch) => void> = [];

  for (const row of userRows) {
    const rawUid = str(row.uid, 128);
    if (!rawUid) continue;
    const uid = scopeIdForSpace(rawUid, 'usr', spaceId);
    const rawUsername = normalizeUsername(str(row.username, 64));
    const username = rawUsername && isValidUsernameFormat(rawUsername) ? rawUsername : '';
    const employeeCode = str(row.employeeCode, 32) || uid.slice(0, 12);
    const fullName = str(row.fullName, 120) || employeeCode;
    const title = str(row.title, 120);
    const parsedRoles = splitList(row.roles).filter((r): r is RoleCode =>
      VALID_ROLES.includes(r as RoleCode)
    );
    const isSelfAdmin = uid === actor.uid || username === DEFAULT_ADMIN_USERNAME;
    const roles: RoleCode[] = isSelfAdmin
      ? Array.from(new Set<RoleCode>(['ADMIN', ...parsedRoles]))
      : parsedRoles.length > 0
      ? parsedRoles
      : ['CHUYEN_VIEN'];
    const isActive = isSelfAdmin ? true : parseBool(row.isActive, true);
    const rawGroupId = str(row.groupId, 64);
    const groupId = rawGroupId ? scopeIdForSpace(rawGroupId, 'grp', spaceId) : '';
    const rawManagerId = str(row.managerId, 128);
    const managerId = rawManagerId ? scopeIdForSpace(rawManagerId, 'usr', spaceId) : '';
    const email = str(row.email, 160).toLowerCase();
    const initialPassword = str(row.initialPassword, 128);

    const existingRaw = existingUsersMap.get(uid);
    let authUid =
      existingRaw && typeof existingRaw.authUid === 'string' ? existingRaw.authUid : '';
    let provisionedNow = false;

    if (!authUid && username && initialPassword && !validatePasswordStrength(initialPassword)) {
      const internalEmail = getInternalAuthEmail(username);
      try {
        const cred = await createUserWithEmailAndPassword(
          provisionerAuth,
          internalEmail,
          initialPassword
        );
        authUid = cred.user.uid;
        provisionedNow = true;
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code?: unknown }).code || '')
            : '';
        if (code === 'auth/email-already-in-use') {
          try {
            const cred = await signInWithEmailAndPassword(
              provisionerAuth,
              internalEmail,
              initialPassword
            );
            authUid = cred.user.uid;
            provisionedNow = true;
          } catch {
            authUid = '';
          }
        }
      } finally {
        try {
          await signOut(provisionerAuth);
        } catch {
          // ignore
        }
      }
    }

    if (!authUid) {
      summary.skippedUsersNoAuth += 1;
      continue;
    }

    const encryptedAccount = await encryptAccountData(spaceKey, {
      username,
      employeeCode,
      fullName,
      title,
      email,
    });

    const mustChangePassword = provisionedNow
      ? true
      : Boolean(existingRaw?.mustChangePassword);

    userOps.push((b) =>
      b.set(doc(db, 'users', uid), {
        uid,
        authUid,
        encryptedAccount,
        mustChangePassword,
        roles,
        groupId,
        managerId,
        isActive,
        departmentId: spaceId,
        createdAt: existingRaw?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const bindingSnap = await getDocFromServer(doc(db, 'authBindings', authUid));
    if (bindingSnap.exists()) {
      bindingOps.push((b) =>
        b.update(doc(db, 'authBindings', authUid), {
          isActive,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      bindingOps.push((b) =>
        b.set(doc(db, 'authBindings', authUid), {
          authUid,
          userId: uid,
          departmentId: spaceId,
          isActive,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    if (email) {
      const encryptedPrivate = await encryptPrivateData(spaceKey, { email });
      privateOps.push((b) =>
        b.set(doc(db, 'users', uid, 'private', 'info'), {
          uid,
          encryptedPrivate,
          updatedAt: serverTimestamp(),
        })
      );
    }

    if (isActive) activeUserIds.add(uid);
    else activeUserIds.delete(uid);

    importedUsersList.push({
      uid,
      authUid,
      encryptedAccount,
      mustChangePassword,
      username,
      employeeCode,
      fullName,
      title,
      email,
      roles,
      groupId,
      managerId,
      isActive,
      departmentId: spaceId,
    });

    if (provisionedNow) {
      summary.credentials += 1;
    }
    summary.users += 1;
  }

  if (userOps.length > 0) {
    await runBatchOps(userOps);
  }
  if (bindingOps.length > 0) {
    await runBatchOps(bindingOps);
  }
  if (privateOps.length > 0) {
    await runBatchOps(privateOps);
  }

  // 3. NhomViec (Groups)
  const groupRows = readSheet('NhomViec');
  const groupOps: Array<(b: WriteBatch) => void> = [];
  for (const row of groupRows) {
    const id = scopeIdForSpace(str(row.id, 128), 'grp', spaceId);
    const code = str(row.code, 32) || id.toUpperCase().slice(0, 32);
    const name = str(row.name, 120) || code;
    const description = str(row.description, 500);
    const rawLeader = str(row.leaderId, 128);
    const leaderId = rawLeader ? scopeIdForSpace(rawLeader, 'usr', spaceId) : '';
    const memberUids = splitList(row.memberUids)
      .slice(0, 50)
      .map((u) => scopeIdForSpace(u, 'usr', spaceId));

    const payload = {
      id,
      code,
      name,
      description,
      leaderId,
      memberUids,
      departmentId: spaceId,
      updatedAt: serverTimestamp(),
    };
    if (existingGroupIds.has(id)) {
      groupOps.push((b) => b.update(doc(db, 'groups', id), payload));
    } else {
      groupOps.push((b) =>
        b.set(doc(db, 'groups', id), {
          ...payload,
          createdAt: serverTimestamp(),
        })
      );
    }
    summary.groups += 1;
  }
  if (groupOps.length > 0) {
    await runBatchOps(groupOps);
  }

  // 4. DuAn (Projects) + project members
  const projectRows = readSheet('DuAn');
  const projectOps: Array<(b: WriteBatch) => void> = [];
  const projectIdsSet = new Set<string>(existingProjectsMap.keys());

  for (const row of projectRows) {
    const id = scopeIdForSpace(str(row.id, 128), 'prj', spaceId);
    const code = (str(row.code, 32) || id).toUpperCase().slice(0, 32);
    const name = str(row.name, 160) || code;
    const description = str(row.description, 2000);
    const startDate = str(row.startDate, 20);
    const expectedEndDate = str(row.expectedEndDate, 20);
    const rawStatus = str(row.status, 32) as ProjectStatus;
    const status: ProjectStatus = VALID_PROJECT_STATUSES.includes(rawStatus)
      ? rawStatus
      : 'DANG_THUC_HIEN';
    const rawPm = str(row.pmId, 128);
    const pmId = rawPm ? scopeIdForSpace(rawPm, 'usr', spaceId) : actor.uid;
    const memberIds = Array.from(
      new Set([pmId, ...splitList(row.memberIds).map((u) => scopeIdForSpace(u, 'usr', spaceId))])
    ).slice(0, 50);
    const labels = splitList(row.labels).slice(0, 15);
    const rawCreator = str(row.createdBy, 128);
    const mappedCreator = rawCreator ? scopeIdForSpace(rawCreator, 'usr', spaceId) : actor.uid;
    const createdBy = activeUserIds.has(mappedCreator) ? mappedCreator : actor.uid;

    const existing = existingProjectsMap.get(id);
    if (existing) {
      projectOps.push((b) =>
        b.update(doc(db, 'projects', id), {
          code,
          name,
          description,
          startDate,
          expectedEndDate,
          status,
          pmId,
          memberIds,
          labels,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      projectOps.push((b) =>
        b.set(doc(db, 'projects', id), {
          id,
          code,
          name,
          description,
          startDate,
          expectedEndDate,
          status,
          pmId,
          memberIds,
          labels,
          createdBy,
          departmentId: spaceId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    for (const uid of memberIds) {
      projectOps.push((b) =>
        b.set(doc(db, 'projects', id, 'members', uid), {
          userId: uid,
          projectRole: uid === pmId ? 'QUAN_LY_DU_AN' : 'THANH_VIEN',
          joinedAt: serverTimestamp(),
        })
      );
    }

    projectIdsSet.add(id);
    summary.projects += 1;
  }
  if (projectOps.length > 0) {
    await runBatchOps(projectOps);
  }

  // 5. CongViec (Tasks)
  const taskRows = readSheet('CongViec');
  const taskOps: Array<(b: WriteBatch) => void> = [];
  const validTaskIds = new Set<string>(existingTasksMap.keys());

  for (const row of taskRows) {
    const id = scopeIdForSpace(str(row.id, 128), 'tsk', spaceId);
    const existing = existingTasksMap.get(id);
    if (existing?.isLocked) {
      summary.skippedLockedTasks += 1;
      validTaskIds.add(id);
      continue;
    }

    const code = str(row.code, 32) || id.slice(0, 16).toUpperCase();
    const title = str(row.title, 200) || code;
    const description = str(row.description, 5000);
    const rawProjectId = str(row.projectId, 64);
    const mappedProjectId = rawProjectId ? scopeIdForSpace(rawProjectId, 'prj', spaceId) : '';
    const projectId = mappedProjectId && projectIdsSet.has(mappedProjectId) ? mappedProjectId : '';
    const rawGroupId = str(row.groupId, 64);
    const groupId = rawGroupId ? scopeIdForSpace(rawGroupId, 'grp', spaceId) : '';

    const rawCreator = str(row.creatorId, 128);
    const mappedCreator = rawCreator ? scopeIdForSpace(rawCreator, 'usr', spaceId) : actor.uid;
    const creatorId = activeUserIds.has(mappedCreator) ? mappedCreator : actor.uid;
    const rawAssignee = str(row.assigneeId, 128);
    const assigneeId = rawAssignee ? scopeIdForSpace(rawAssignee, 'usr', spaceId) : creatorId;
    const rawReviewer = str(row.reviewerId, 128);
    const reviewerId = rawReviewer ? scopeIdForSpace(rawReviewer, 'usr', spaceId) : creatorId;
    const rawParentTask = str(row.parentTaskId, 64);
    const parentTaskId = rawParentTask ? scopeIdForSpace(rawParentTask, 'tsk', spaceId) : '';

    const rawPriority = str(row.priority, 32) as TaskPriority;
    const priority: TaskPriority = VALID_PRIORITIES.includes(rawPriority)
      ? rawPriority
      : 'TRUNG_BINH';
    const startDate = str(row.startDate, 20);
    const dueDate = str(row.dueDate, 20);
    const estimatedHours = Math.min(10000, Math.max(0, Number(row.estimatedHours) || 0));
    const labels = splitList(row.labels).slice(0, 10);
    const attachments = splitList(row.attachments).slice(0, 10);

    const rawStatus = str(row.status, 32) as TaskStatus;
    const status: TaskStatus = VALID_TASK_STATUSES.includes(rawStatus) ? rawStatus : 'MOI';
    const rawSubStatus = str(row.submissionStatus, 32) as SubmissionStatus;
    const submissionStatus: SubmissionStatus = VALID_SUBMISSION_STATUSES.includes(rawSubStatus)
      ? rawSubStatus
      : 'CHUA_NOP';
    const submissionNote = str(row.submissionNote, 1000);
    const rawReview = str(row.reviewResult, 32) as ReviewResult;
    const reviewResult: ReviewResult = VALID_REVIEW_RESULTS.includes(rawReview)
      ? rawReview
      : 'CHO_XAC_NHAN';
    const reviewNote = str(row.reviewNote, 1000);
    const isLocked = parseBool(row.isLocked, status === 'HOAN_THANH');
    const participantIds = Array.from(
      new Set([
        creatorId,
        assigneeId,
        reviewerId,
        actor.uid,
        ...splitList(row.participantIds).map((u) => scopeIdForSpace(u, 'usr', spaceId)),
      ])
    ).slice(0, 50);

    if (existing) {
      taskOps.push((b) =>
        b.update(doc(db, 'tasks', id), {
          title,
          description,
          projectId,
          groupId,
          assigneeId,
          reviewerId,
          parentTaskId,
          priority,
          startDate,
          dueDate,
          estimatedHours,
          labels,
          attachments,
          status,
          submissionStatus,
          submissionNote,
          reviewResult,
          reviewNote,
          isLocked,
          participantIds,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      taskOps.push((b) =>
        b.set(doc(db, 'tasks', id), {
          id,
          code,
          title,
          description,
          projectId,
          groupId,
          creatorId,
          assigneeId,
          reviewerId,
          parentTaskId,
          priority,
          startDate,
          dueDate,
          estimatedHours,
          labels,
          attachments,
          status,
          submissionStatus,
          submissionNote,
          reviewResult,
          reviewNote,
          isLocked,
          participantIds,
          departmentId: spaceId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    validTaskIds.add(id);
    summary.tasks += 1;
  }
  if (taskOps.length > 0) {
    await runBatchOps(taskOps);
  }

  // 6. DauViecCon (Subtasks) & BinhLuan (Comments)
  const subtaskRows = readSheet('DauViecCon');
  const subOps: Array<(b: WriteBatch) => void> = [];
  for (const row of subtaskRows) {
    const taskId = scopeIdForSpace(str(row.taskId, 128), 'tsk', spaceId);
    if (!validTaskIds.has(taskId)) continue;
    const id = scopeIdForSpace(str(row.id, 128), 'sub', spaceId);
    const title = str(row.title, 200);
    if (!title) continue;
    const isDone = parseBool(row.isDone, false);
    const rawCreatedBy = str(row.createdBy, 128);
    const createdBy = rawCreatedBy ? scopeIdForSpace(rawCreatedBy, 'usr', spaceId) : actor.uid;
    const taskParticipantIds = Array.from(
      new Set([
        actor.uid,
        createdBy,
        ...splitList(row.taskParticipantIds).map((u) => scopeIdForSpace(u, 'usr', spaceId)),
      ])
    ).slice(0, 50);

    subOps.push((b) =>
      b.set(doc(db, 'tasks', taskId, 'subtasks', id), {
        id,
        title,
        isDone,
        createdBy,
        taskParticipantIds,
        createdAt: serverTimestamp(),
      })
    );
    summary.subtasks += 1;
  }
  if (subOps.length > 0) {
    await runBatchOps(subOps);
  }

  const commentRows = readSheet('BinhLuan');
  const cmtOps: Array<(b: WriteBatch) => void> = [];
  for (const row of commentRows) {
    const taskId = scopeIdForSpace(str(row.taskId, 128), 'tsk', spaceId);
    if (!validTaskIds.has(taskId)) continue;
    const id = scopeIdForSpace(str(row.id, 128), 'cmt', spaceId);
    const content = str(row.content, 2000);
    if (!content) continue;
    const rawAuthor = str(row.authorId, 128);
    const mappedAuthor = rawAuthor ? scopeIdForSpace(rawAuthor, 'usr', spaceId) : actor.uid;
    const authorId = activeUserIds.has(mappedAuthor) ? mappedAuthor : actor.uid;
    const authorName = str(row.authorName, 120) || actor.fullName;
    const mentions = splitList(row.mentions)
      .slice(0, 20)
      .map((u) => scopeIdForSpace(u, 'usr', spaceId));
    const taskParticipantIds = Array.from(
      new Set([
        actor.uid,
        authorId,
        ...splitList(row.taskParticipantIds).map((u) => scopeIdForSpace(u, 'usr', spaceId)),
      ])
    ).slice(0, 50);

    cmtOps.push((b) =>
      b.set(doc(db, 'tasks', taskId, 'comments', id), {
        id,
        authorId,
        authorName,
        content,
        mentions,
        taskParticipantIds,
        createdAt: serverTimestamp(),
      })
    );
    summary.comments += 1;
  }
  if (cmtOps.length > 0) {
    await runBatchOps(cmtOps);
  }

  // 7. MoKhoaLogWork (WorkLogUnlocks) + auto-unlocks for historical WorkLogs being restored
  const unlockRows = readSheet('MoKhoaLogWork');
  const workLogRows = readSheet('NhatKyLamViec');
  const { dateNum: todayNum } = getVietnamNowParts();

  const ulOps: Array<(b: WriteBatch) => void> = [];
  const coveredUnlockKeys = new Set<string>(existingUlIds);

  for (const row of unlockRows) {
    const userId = scopeIdForSpace(str(row.userId, 128), 'usr', spaceId);
    const workDate = str(row.workDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
    const id = `${userId}_${workDate}`.slice(0, 128);
    const rawUnlockedBy = str(row.unlockedBy, 128);
    const mappedUnlockedBy = rawUnlockedBy
      ? scopeIdForSpace(rawUnlockedBy, 'usr', spaceId)
      : actor.uid;
    const unlockedBy = activeUserIds.has(mappedUnlockedBy) ? mappedUnlockedBy : actor.uid;
    const reason = str(row.reason, 500);
    const safeReason = reason.length >= 3 ? reason : 'Khôi phục từ bản sao lưu Excel';

    ulOps.push((b) =>
      b.set(doc(db, 'workLogUnlocks', id), {
        id,
        userId,
        workDate,
        unlockedBy,
        reason: safeReason,
        departmentId: spaceId,
        unlockedAt: serverTimestamp(),
      })
    );
    coveredUnlockKeys.add(id);
  }

  for (const row of workLogRows) {
    const rawUser = str(row.userId, 128);
    const mappedUser = rawUser ? scopeIdForSpace(rawUser, 'usr', spaceId) : actor.uid;
    const userId = activeUserIds.has(mappedUser) ? mappedUser : actor.uid;
    const workDate = str(row.workDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
    const workDateNum = dateStrToNum(workDate);
    const key = `${userId}_${workDate}`.slice(0, 128);
    if (workDateNum < todayNum && !coveredUnlockKeys.has(key)) {
      ulOps.push((b) =>
        b.set(doc(db, 'workLogUnlocks', key), {
          id: key,
          userId,
          workDate,
          unlockedBy: actor.uid,
          reason: 'Khôi phục nhật ký làm việc từ file Excel',
          departmentId: spaceId,
          unlockedAt: serverTimestamp(),
        })
      );
      coveredUnlockKeys.add(key);
    }
  }
  if (ulOps.length > 0) {
    await runBatchOps(ulOps);
  }

  // 8. NhatKyLamViec (WorkLogs)
  const wlOps: Array<(b: WriteBatch) => void> = [];
  for (const row of workLogRows) {
    const id = scopeIdForSpace(str(row.id, 128), 'wl', spaceId);
    const taskId = scopeIdForSpace(str(row.taskId, 128), 'tsk', spaceId);
    if (!validTaskIds.has(taskId)) continue;
    const rawUser = str(row.userId, 128);
    const mappedUser = rawUser ? scopeIdForSpace(rawUser, 'usr', spaceId) : actor.uid;
    const userId = activeUserIds.has(mappedUser) ? mappedUser : actor.uid;
    const workDate = str(row.workDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
    const workDateNum = dateStrToNum(workDate);
    if (workDateNum < 20200101 || workDateNum > 21001231) continue;
    const hours = Math.min(24, Math.max(0.25, Number(row.hours) || 1));
    const progressPercent = Math.min(100, Math.max(0, Number(row.progressPercent) || 0));
    const note = str(row.note, 1000) || 'Nhật ký làm việc';
    const rawProjectId = str(row.projectId, 64);
    const mappedProjectId = rawProjectId ? scopeIdForSpace(rawProjectId, 'prj', spaceId) : '';
    const projectId = mappedProjectId && projectIdsSet.has(mappedProjectId) ? mappedProjectId : '';
    const viewerIds = Array.from(
      new Set([
        userId,
        actor.uid,
        ...splitList(row.viewerIds).map((u) => scopeIdForSpace(u, 'usr', spaceId)),
      ])
    ).slice(0, 30);

    if (existingWlIds.has(id)) {
      wlOps.push((b) =>
        b.update(doc(db, 'workLogs', id), {
          taskId,
          projectId,
          hours,
          progressPercent,
          note,
          viewerIds,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      wlOps.push((b) =>
        b.set(doc(db, 'workLogs', id), {
          id,
          userId,
          taskId,
          projectId,
          workDate,
          workDateNum,
          hours,
          progressPercent,
          note,
          viewerIds,
          departmentId: spaceId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    summary.workLogs += 1;
  }
  if (wlOps.length > 0) {
    await runBatchOps(wlOps);
  }

  // 9. CauHinh (SystemConfig)
  const cfgRows = readSheet('CauHinh');
  if (cfgRows.length > 0) {
    const c = cfgRows[0];
    const cfgOps: Array<(b: WriteBatch) => void> = [
      (b) =>
        b.set(doc(db, 'systemConfigs', cfgId), {
          lockHour: Math.min(23, Math.max(0, Number(c.lockHour) || 23)),
          lockMinute: Math.min(59, Math.max(0, Number(c.lockMinute) || 59)),
          reminderHour: Math.min(23, Math.max(0, Number(c.reminderHour) || 17)),
          reminderMinute: Math.min(59, Math.max(0, Number(c.reminderMinute) || 30)),
          timezone: str(c.timezone, 40) || 'Asia/Ho_Chi_Minh',
          defaultLabels: splitList(c.defaultLabels).slice(0, 30),
          holidays: splitList(c.holidays).slice(0, 50),
          departmentId: spaceId,
          updatedBy: actor.uid,
          updatedAt: serverTimestamp(),
        }),
    ];
    await runBatchOps(cfgOps);
  }

  await logSystemAudit({
    actor,
    action: 'Import cơ sở dữ liệu Excel',
    targetType: 'system',
    targetId: spaceId,
    detail: `Import từ file ${file.name}: ${summary.users} nhân sự, ${summary.groups} nhóm, ${summary.projects} dự án, ${summary.tasks} công việc, ${summary.workLogs} log work`,
    allUsers: importedUsersList.length > 0 ? importedUsersList : [actor],
  });

  return summary;
}
