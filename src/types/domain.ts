export type RoleCode =
  | 'ADMIN'
  | 'TRUONG_PHONG'
  | 'PHO_PHONG'
  | 'QUAN_LY_DU_AN'
  | 'TRUONG_NHOM'
  | 'CHUYEN_VIEN';

export type ProjectStatus =
  | 'CHUAN_BI'
  | 'DANG_THUC_HIEN'
  | 'TAM_DUNG'
  | 'HOAN_THANH'
  | 'DONG';

export type TaskPriority = 'THAP' | 'TRUNG_BINH' | 'CAO' | 'KHAN_CAP';

export type TaskStatus =
  | 'MOI'
  | 'DANG_THUC_HIEN'
  | 'CHO_XAC_NHAN'
  | 'CHUA_HOAN_THANH'
  | 'HOAN_THANH'
  | 'TAM_HOAN'
  | 'HUY';

export type SubmissionStatus = 'CHUA_NOP' | 'DA_NOP';

export type ReviewResult = 'CHO_XAC_NHAN' | 'DA_HOAN_THANH' | 'CHUA_HOAN_THANH';

export interface UserProfile {
  uid: string;
  username?: string;
  authUid?: string;
  employeeCode: string;
  fullName: string;
  title?: string;
  roles: RoleCode[];
  groupId?: string;
  managerId?: string;
  isActive: boolean;
  departmentId: string;
  email?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuthCredential {
  username: string;
  userId: string;
  passwordHash: string;
  mustChangePassword: boolean;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil?: number;
  departmentId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkGroup {
  id: string;
  code: string;
  name: string;
  description?: string;
  leaderId: string;
  memberUids: string[];
  departmentId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description?: string;
  startDate?: string;
  expectedEndDate?: string;
  status: ProjectStatus;
  pmId: string;
  memberIds: string[];
  labels?: string[];
  createdBy: string;
  departmentId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TaskItem {
  id: string;
  code: string;
  title: string;
  description?: string;
  projectId?: string;
  groupId: string;
  creatorId: string;
  assigneeId: string;
  reviewerId: string;
  parentTaskId?: string;
  priority: TaskPriority;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  labels?: string[];
  attachments?: string[];
  status: TaskStatus;
  submissionStatus: SubmissionStatus;
  submissionNote?: string;
  reviewResult: ReviewResult;
  reviewNote?: string;
  isLocked: boolean;
  participantIds: string[];
  departmentId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TaskSubtask {
  id: string;
  title: string;
  isDone: boolean;
  createdBy: string;
  taskParticipantIds: string[];
  createdAt?: unknown;
}

export interface TaskComment {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  mentions?: string[];
  taskParticipantIds: string[];
  createdAt?: unknown;
}

export interface TaskAuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  detail: string;
  taskParticipantIds: string[];
  createdAt?: unknown;
}

export interface WorkLog {
  id: string;
  userId: string;
  taskId: string;
  projectId?: string;
  workDate: string;
  workDateNum: number;
  hours: number;
  progressPercent?: number;
  note: string;
  viewerIds: string[];
  departmentId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WorkLogUnlock {
  id: string;
  userId: string;
  workDate: string;
  unlockedBy: string;
  reason: string;
  departmentId: string;
  unlockedAt?: unknown;
}

export interface SystemConfig {
  lockHour: number;
  lockMinute: number;
  reminderHour: number;
  reminderMinute: number;
  timezone: string;
  defaultLabels: string[];
  holidays?: string[];
  updatedBy?: string;
  updatedAt?: unknown;
}

export interface SystemAuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  viewerIds: string[];
  departmentId: string;
  createdAt?: unknown;
}

export const DEPARTMENT_ID = 'DAMA2';
export const DEFAULT_ADMIN_USERNAME = 'mbfs_admin';

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: 'Quản trị hệ thống',
  TRUONG_PHONG: 'Trưởng phòng',
  PHO_PHONG: 'Phó phòng',
  QUAN_LY_DU_AN: 'Quản lý dự án',
  TRUONG_NHOM: 'Trưởng nhóm',
  CHUYEN_VIEN: 'Chuyên viên',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  CHUAN_BI: 'Chuẩn bị',
  DANG_THUC_HIEN: 'Đang thực hiện',
  TAM_DUNG: 'Tạm dừng',
  HOAN_THANH: 'Hoàn thành',
  DONG: 'Đóng',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  THAP: 'Thấp',
  TRUNG_BINH: 'Trung bình',
  CAO: 'Cao',
  KHAN_CAP: 'Khẩn cấp',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  MOI: 'Mới',
  DANG_THUC_HIEN: 'Đang thực hiện',
  CHO_XAC_NHAN: 'Chờ xác nhận',
  CHUA_HOAN_THANH: 'Chưa hoàn thành',
  HOAN_THANH: 'Đã hoàn thành',
  TAM_HOAN: 'Tạm hoãn',
  HUY: 'Hủy',
};

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  CHUA_NOP: 'Chưa nộp',
  DA_NOP: 'Đã nộp kết quả',
};

export const REVIEW_RESULT_LABELS: Record<ReviewResult, string> = {
  CHO_XAC_NHAN: 'Chờ xác nhận',
  DA_HOAN_THANH: 'Đã hoàn thành',
  CHUA_HOAN_THANH: 'Chưa hoàn thành',
};

export const KANBAN_COLUMNS: TaskStatus[] = [
  'MOI',
  'DANG_THUC_HIEN',
  'CHO_XAC_NHAN',
  'CHUA_HOAN_THANH',
  'HOAN_THANH',
  'TAM_HOAN',
];
