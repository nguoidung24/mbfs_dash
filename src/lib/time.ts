import { SystemConfig, TaskItem, WorkLogUnlock } from '../types/domain';

const VN_TZ = 'Asia/Ho_Chi_Minh';

export function getVietnamNowParts(): {
  dateStr: string;
  dateNum: number;
  hour: number;
  minute: number;
} {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const dateNum = Number(`${map.year}${map.month}${map.day}`);
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const minute = Number(map.minute);
  return { dateStr, dateNum, hour, minute };
}

export function dateStrToNum(dateStr: string): number {
  return Number(dateStr.replace(/-/g, ''));
}

export function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return 'Vừa xong';
  let date: Date | null = null;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    date = (ts as { toDate: () => Date }).toDate();
  } else if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'string' || typeof ts === 'number') {
    date = new Date(ts);
  }
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function isTaskOverdue(task: TaskItem): boolean {
  if (!task.dueDate) return false;
  if (task.status === 'HOAN_THANH' || task.status === 'HUY') return false;
  const { dateStr } = getVietnamNowParts();
  return task.dueDate < dateStr;
}

export interface WorkLogDateAccess {
  canEdit: boolean;
  reason: string;
  state: 'OPEN_TODAY' | 'UNLOCKED' | 'LOCKED_PAST' | 'LOCKED_AFTER_HOURS' | 'BLOCKED_FUTURE';
}

export function evaluateWorkLogDateAccess(
  targetUserId: string,
  workDate: string,
  config: SystemConfig | null,
  unlocks: WorkLogUnlock[],
  isAdminUser: boolean
): WorkLogDateAccess {
  const { dateStr: todayStr, hour, minute } = getVietnamNowParts();
  const lockHour = config?.lockHour ?? 23;
  const lockMinute = config?.lockMinute ?? 59;

  if (workDate > todayStr) {
    return {
      canEdit: false,
      state: 'BLOCKED_FUTURE',
      reason: 'Không được phép ghi nhật ký công việc cho ngày tương lai.',
    };
  }

  const hasUnlock = unlocks.some(
    (u) => u.userId === targetUserId && u.workDate === workDate
  );

  if (workDate < todayStr) {
    if (hasUnlock) {
      return {
        canEdit: true,
        state: 'UNLOCKED',
        reason: 'Ngày này đã được cấp trên mở khóa bổ sung.',
      };
    }
    if (isAdminUser) {
      return {
        canEdit: true,
        state: 'UNLOCKED',
        reason: 'Quản trị viên có quyền điều chỉnh dữ liệu.',
      };
    }
    return {
      canEdit: false,
      state: 'LOCKED_PAST',
      reason: `Ngày ${formatDisplayDate(workDate)} đã khóa sau ${String(lockHour).padStart(2, '0')}:${String(lockMinute).padStart(2, '0')}. Cần Admin hoặc Trưởng/Phó phòng mở khóa.`,
    };
  }

  // workDate === todayStr
  const pastLockTime = hour > lockHour || (hour === lockHour && minute > lockMinute);
  if (pastLockTime) {
    if (hasUnlock || isAdminUser) {
      return {
        canEdit: true,
        state: 'UNLOCKED',
        reason: 'Đã mở khóa ghi nhận sau giờ khóa ngày.',
      };
    }
    return {
      canEdit: false,
      state: 'LOCKED_AFTER_HOURS',
      reason: `Đã quá giờ khóa ngày (${String(lockHour).padStart(2, '0')}:${String(lockMinute).padStart(2, '0')} UTC+7).`,
    };
  }

  return {
    canEdit: true,
    state: 'OPEN_TODAY',
    reason: `Đang mở ghi nhận đến ${String(lockHour).padStart(2, '0')}:${String(lockMinute).padStart(2, '0')} giờ Việt Nam.`,
  };
}

export function getMonthDates(year: number, monthIndex0: number): string[] {
  const dates: string[] = [];
  const d = new Date(year, monthIndex0, 1);
  while (d.getMonth() === monthIndex0) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export function getCurrentWeekDates(referenceDateStr?: string): string[] {
  const base = referenceDateStr ? new Date(`${referenceDateStr}T12:00:00`) : new Date();
  const day = base.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMonday);
  const res: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const yyyy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    res.push(`${yyyy}-${mm}-${dd}`);
  }
  return res;
}

export function getDateStrFromTimestamp(ts: unknown): string {
  if (!ts) return '';
  let date: Date | null = null;
  if (
    typeof ts === 'object' &&
    ts !== null &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    date = (ts as { toDate: () => Date }).toDate();
  } else if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'string' || typeof ts === 'number') {
    date = new Date(ts);
  }
  if (!date || Number.isNaN(date.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

export type TaskDateFilterMode = 'DUE_DATE' | 'OVERLAP' | 'START_DATE' | 'CREATED_AT';

export const TASK_DATE_MODE_LABELS: Record<TaskDateFilterMode, string> = {
  DUE_DATE: 'Theo hạn hoàn thành',
  OVERLAP: 'Trong khoảng thực hiện',
  START_DATE: 'Theo ngày bắt đầu',
  CREATED_AT: 'Theo ngày tạo',
};

export function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getDateRangePresets(): {
  today: { from: string; to: string };
  thisWeek: { from: string; to: string };
  thisMonth: { from: string; to: string };
  last30Days: { from: string; to: string };
} {
  const { dateStr: today } = getVietnamNowParts();
  const weekDates = getCurrentWeekDates(today);
  const [yearStr, monthStr] = today.split('-');
  const monthStart = `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(Number(yearStr), Number(monthStr), 0).getDate();
  const monthEnd = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  return {
    today: { from: today, to: today },
    thisWeek: { from: weekDates[0], to: weekDates[6] },
    thisMonth: { from: monthStart, to: monthEnd },
    last30Days: { from: shiftDateStr(today, -29), to: today },
  };
}

export function filterTasksByDateRange(
  tasks: TaskItem[],
  fromDate: string,
  toDate: string,
  mode: TaskDateFilterMode = 'DUE_DATE'
): TaskItem[] {
  const rawFrom = fromDate.trim();
  const rawTo = toDate.trim();
  if (!rawFrom && !rawTo) return tasks;

  const hasBoth = Boolean(rawFrom && rawTo);
  const from = hasBoth && rawFrom > rawTo ? rawTo : rawFrom;
  const to = hasBoth && rawFrom > rawTo ? rawFrom : rawTo;

  return tasks.filter((task) => {
    if (mode === 'DUE_DATE') {
      const target = task.dueDate || '';
      if (!target) return false;
      if (from && target < from) return false;
      if (to && target > to) return false;
      return true;
    }

    if (mode === 'START_DATE') {
      const target = task.startDate || '';
      if (!target) return false;
      if (from && target < from) return false;
      if (to && target > to) return false;
      return true;
    }

    if (mode === 'CREATED_AT') {
      const target = getDateStrFromTimestamp(task.createdAt);
      if (!target) return false;
      if (from && target < from) return false;
      if (to && target > to) return false;
      return true;
    }

    // OVERLAP: task interval [start, end] overlaps [from, to]
    const createdStr = getDateStrFromTimestamp(task.createdAt);
    const start = task.startDate || task.dueDate || createdStr;
    const end = task.dueDate || task.startDate || createdStr;
    if (!start && !end) return false;
    if (from && end < from) return false;
    if (to && start > to) return false;
    return true;
  });
}

