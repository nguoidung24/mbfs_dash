import { useMemo, useState } from 'react';
import { ArrowRight, FolderKanban, RotateCcw, Settings, ShieldCheck } from 'lucide-react';
import {
  PRIORITY_LABELS,
  Project,
  TASK_STATUS_LABELS,
  TaskItem,
  TaskPriority,
  TaskStatus,
  UserProfile,
  WorkGroup,
  WorkLog,
} from '../types/domain';
import { canReviewTask, getManagedProjects, getUserScopeTier, UserScopeTier } from '../lib/rbac';
import {
  filterTasksByDateRange,
  formatDisplayDate,
  getVietnamNowParts,
  isTaskOverdue,
  shiftDateStr,
  TaskDateFilterMode,
} from '../lib/time';
import { DateRangeFilterBar } from './DateRangeFilterBar';
import { PriorityLabel, TaskStatusLabel } from './StatusText';

interface DashboardViewProps {
  currentUser: UserProfile;
  tasks: TaskItem[];
  projects: Project[];
  scopedUsers: UserProfile[];
  allUsers: UserProfile[];
  groups: WorkGroup[];
  workLogs: WorkLog[];
  onSelectTask: (task: TaskItem) => void;
  onNavigateList: () => void;
  onCreateTask: () => void;
  onNavigateAdmin?: () => void;
  onNavigateProjects?: () => void;
}

const STATUS_BAR_COLOR: Record<TaskStatus, string> = {
  MOI: 'bg-slate-500',
  DANG_THUC_HIEN: 'bg-blue-600',
  CHO_XAC_NHAN: 'bg-amber-500',
  CHUA_HOAN_THANH: 'bg-red-500',
  HOAN_THANH: 'bg-emerald-600',
  TAM_HOAN: 'bg-slate-400',
  HUY: 'bg-slate-300',
};

const PRIORITY_BAR_COLOR: Record<TaskPriority, string> = {
  KHAN_CAP: 'bg-red-600',
  CAO: 'bg-amber-600',
  TRUNG_BINH: 'bg-blue-600',
  THAP: 'bg-slate-400',
};

const TIER_META: Record<
  UserScopeTier,
  { badge: string; title: string; accentClass: string }
> = {
  SYSTEM_ADMIN: {
    badge: 'Quản trị hệ thống',
    title: 'Dashboard Quản trị & Giám sát Toàn hệ thống',
    accentClass: 'border-l-slate-900',
  },
  DEPARTMENT_HEAD: {
    badge: 'Lãnh đạo phòng ban',
    title: 'Dashboard Điều hành Toàn Phòng ban',
    accentClass: 'border-l-blue-700',
  },
  SCOPE_MANAGER: {
    badge: 'Quản lý phạm vi',
    title: 'Dashboard Phạm vi Phụ trách',
    accentClass: 'border-l-indigo-700',
  },
  STAFF: {
    badge: 'Chuyên viên',
    title: 'Dashboard Công việc Cá nhân',
    accentClass: 'border-l-emerald-700',
  },
};

export function DashboardView({
  currentUser,
  tasks,
  projects,
  scopedUsers,
  allUsers,
  groups,
  workLogs,
  onSelectTask,
  onNavigateList,
  onCreateTask,
  onNavigateAdmin,
  onNavigateProjects,
}: DashboardViewProps) {
  const tier = getUserScopeTier(currentUser);
  const managedProjects = useMemo(
    () => getManagedProjects(currentUser, projects),
    [currentUser, projects]
  );

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateMode, setDateMode] = useState<TaskDateFilterMode>('DUE_DATE');
  const [groupId, setGroupId] = useState('ALL');
  const [projectId, setProjectId] = useState('ALL');
  const [assigneeId, setAssigneeId] = useState('ALL');
  const [breakdownTab, setBreakdownTab] = useState<'GROUPS' | 'PROJECTS' | 'USERS'>(
    tier === 'SCOPE_MANAGER' ? 'PROJECTS' : 'GROUPS'
  );

  const showGroupFilter =
    tier === 'SYSTEM_ADMIN' ||
    tier === 'DEPARTMENT_HEAD' ||
    (tier === 'SCOPE_MANAGER' && groups.length > 0);
  const showUserFilter = tier !== 'STAFF';

  const hasAnyFilter = Boolean(
    fromDate ||
      toDate ||
      (showGroupFilter && groupId !== 'ALL') ||
      projectId !== 'ALL' ||
      (showUserFilter && assigneeId !== 'ALL')
  );

  const scopedTasks = useMemo(() => {
    const byDate = filterTasksByDateRange(tasks, fromDate, toDate, dateMode);
    return byDate.filter((t) => {
      if (showGroupFilter && groupId !== 'ALL' && t.groupId !== groupId) return false;
      if (projectId === 'REGULAR' && t.projectId) return false;
      if (projectId !== 'ALL' && projectId !== 'REGULAR' && t.projectId !== projectId) return false;
      if (showUserFilter && assigneeId !== 'ALL' && t.assigneeId !== assigneeId) return false;
      return true;
    });
  }, [
    tasks,
    fromDate,
    toDate,
    dateMode,
    showGroupFilter,
    groupId,
    projectId,
    showUserFilter,
    assigneeId,
  ]);

  const scopedWorkLogs = useMemo(() => {
    const rawFrom = fromDate.trim();
    const rawTo = toDate.trim();
    const hasBoth = Boolean(rawFrom && rawTo);
    const effFrom = hasBoth && rawFrom > rawTo ? rawTo : rawFrom;
    const effTo = hasBoth && rawFrom > rawTo ? rawFrom : rawTo;
    const scopedTaskIds = new Set(scopedTasks.map((t) => t.id));

    return workLogs.filter((wl) => {
      if (effFrom && wl.workDate < effFrom) return false;
      if (effTo && wl.workDate > effTo) return false;
      if (showUserFilter && assigneeId !== 'ALL' && wl.userId !== assigneeId) return false;
      if (projectId === 'REGULAR' && wl.projectId) return false;
      if (projectId !== 'ALL' && projectId !== 'REGULAR' && wl.projectId !== projectId) {
        return false;
      }
      if (showGroupFilter && groupId !== 'ALL' && !scopedTaskIds.has(wl.taskId)) {
        const taskOwner = allUsers.find((u) => u.uid === wl.userId);
        if (!taskOwner || taskOwner.groupId !== groupId) return false;
      }
      return true;
    });
  }, [
    workLogs,
    fromDate,
    toDate,
    showUserFilter,
    assigneeId,
    projectId,
    showGroupFilter,
    groupId,
    scopedTasks,
    allUsers,
  ]);

  const stats = useMemo(() => {
    const nonCancelled = scopedTasks.filter((t) => t.status !== 'HUY');
    const cancelledCount = scopedTasks.length - nonCancelled.length;
    const completedCount = nonCancelled.filter((t) => t.status === 'HOAN_THANH').length;
    const inProgressCount = nonCancelled.filter(
      (t) => t.status === 'DANG_THUC_HIEN' || t.status === 'MOI'
    ).length;
    const pendingReviewCount = nonCancelled.filter((t) => t.status === 'CHO_XAC_NHAN').length;
    const myReviewQueueCount = nonCancelled.filter(
      (t) => t.status === 'CHO_XAC_NHAN' && canReviewTask(currentUser, t, projects, groups)
    ).length;
    const rejectedCount = nonCancelled.filter((t) => t.status === 'CHUA_HOAN_THANH').length;
    const overdueCount = nonCancelled.filter((t) => isTaskOverdue(t)).length;
    const urgentOpenCount = nonCancelled.filter(
      (t) =>
        t.status !== 'HOAN_THANH' &&
        (t.priority === 'KHAN_CAP' || t.priority === 'CAO')
    ).length;

    const completionRate =
      nonCancelled.length > 0 ? Math.round((completedCount / nonCancelled.length) * 100) : 0;

    const totalLoggedHours = Math.round(
      scopedWorkLogs.reduce((sum, w) => sum + (Number(w.hours) || 0), 0) * 10
    ) / 10;

    const totalEstimatedHours = Math.round(
      nonCancelled.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0) * 10
    ) / 10;

    return {
      total: scopedTasks.length,
      activeTotal: nonCancelled.length,
      cancelledCount,
      completedCount,
      inProgressCount,
      pendingReviewCount,
      myReviewQueueCount,
      rejectedCount,
      overdueCount,
      urgentOpenCount,
      completionRate,
      totalLoggedHours,
      totalEstimatedHours,
    };
  }, [scopedTasks, scopedWorkLogs, currentUser, projects, groups]);

  const systemHealth = useMemo(() => {
    const activeAccounts = allUsers.filter((u) => u.isActive && u.authUid).length;
    const inactiveOrLocked = allUsers.length - activeAccounts;
    const runningProjects = projects.filter((p) => p.status === 'DANG_THUC_HIEN').length;
    return {
      totalAccounts: allUsers.length,
      activeAccounts,
      inactiveOrLocked,
      groupCount: groups.length,
      runningProjects,
      totalProjects: projects.length,
    };
  }, [allUsers, projects, groups]);

  const statusBreakdown = useMemo(() => {
    const total = Math.max(scopedTasks.length, 1);
    return (Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((st) => {
      const count = scopedTasks.filter((t) => t.status === st).length;
      return {
        status: st,
        label: TASK_STATUS_LABELS[st],
        count,
        pct: Math.round((count / total) * 100),
      };
    });
  }, [scopedTasks]);

  const priorityBreakdown = useMemo(() => {
    const nonCancelled = scopedTasks.filter((t) => t.status !== 'HUY');
    const total = Math.max(nonCancelled.length, 1);
    const order: TaskPriority[] = ['KHAN_CAP', 'CAO', 'TRUNG_BINH', 'THAP'];
    return order.map((p) => {
      const count = nonCancelled.filter((t) => t.priority === p).length;
      return {
        priority: p,
        label: PRIORITY_LABELS[p],
        count,
        pct: Math.round((count / total) * 100),
      };
    });
  }, [scopedTasks]);

  const donutSegments = useMemo(() => {
    const nonCancelled = scopedTasks.filter((t) => t.status !== 'HUY');
    const total = nonCancelled.length;
    if (total === 0) return [];

    let done = 0;
    let overdue = 0;
    let pending = 0;
    let paused = 0;
    let active = 0;

    for (const t of nonCancelled) {
      if (t.status === 'HOAN_THANH') done += 1;
      else if (isTaskOverdue(t) || t.status === 'CHUA_HOAN_THANH') overdue += 1;
      else if (t.status === 'CHO_XAC_NHAN') pending += 1;
      else if (t.status === 'TAM_HOAN') paused += 1;
      else active += 1;
    }

    const raw = [
      { key: 'done', label: 'Đã hoàn thành', count: done, color: '#16A34A' },
      { key: 'active', label: 'Mới / Đang thực hiện', count: active, color: '#1D4ED8' },
      { key: 'pending', label: 'Chờ xác nhận', count: pending, color: '#D97706' },
      { key: 'paused', label: 'Tạm hoãn', count: paused, color: '#64748B' },
      { key: 'overdue', label: 'Quá hạn / Chưa hoàn thành', count: overdue, color: '#DC2626' },
    ].filter((s) => s.count > 0);

    const circumference = 2 * Math.PI * 46;
    let offset = 0;
    return raw.map((seg) => {
      const length = (seg.count / total) * circumference;
      const item = {
        ...seg,
        pct: Math.round((seg.count / total) * 100),
        dasharray: `${length} ${circumference - length}`,
        dashoffset: -offset,
      };
      offset += length;
      return item;
    });
  }, [scopedTasks]);

  const dailyTrend = useMemo(() => {
    const { dateStr: today } = getVietnamNowParts();
    const rawFrom = fromDate.trim();
    const rawTo = toDate.trim();
    const hasBoth = Boolean(rawFrom && rawTo);
    const effTo = (hasBoth && rawFrom > rawTo ? rawFrom : rawTo) || today;
    const effFrom =
      (hasBoth && rawFrom > rawTo ? rawTo : rawFrom) || shiftDateStr(effTo, -6);

    const days: string[] = [];
    let cursor = effFrom;
    let safety = 0;
    while (cursor <= effTo && safety < 62) {
      days.push(cursor);
      cursor = shiftDateStr(cursor, 1);
      safety += 1;
    }
    const visibleDays = days.length > 10 ? days.slice(-10) : days.length > 0 ? days : [today];

    const buckets = visibleDays.map((d) => {
      const dueCount = scopedTasks.filter((t) => t.dueDate === d && t.status !== 'HUY').length;
      const doneCount = scopedTasks.filter(
        (t) => t.dueDate === d && t.status === 'HOAN_THANH'
      ).length;
      const hours = Math.round(
        scopedWorkLogs
          .filter((w) => w.workDate === d)
          .reduce((s, w) => s + (Number(w.hours) || 0), 0) * 10
      ) / 10;
      const parts = d.split('-');
      return {
        dateStr: d,
        shortLabel: `${parts[2]}/${parts[1]}`,
        dueCount,
        doneCount,
        hours,
      };
    });

    const maxBar = Math.max(1, ...buckets.map((b) => Math.max(b.dueCount, Math.ceil(b.hours))));
    return { buckets, maxBar };
  }, [fromDate, toDate, scopedTasks, scopedWorkLogs]);

  // Group breakdown (filtered to `groups` in scope)
  const groupRows = useMemo(() => {
    return groups.map((g) => {
      const gTasks = scopedTasks.filter((t) => t.groupId === g.id && t.status !== 'HUY');
      const done = gTasks.filter((t) => t.status === 'HOAN_THANH').length;
      const overdue = gTasks.filter((t) => isTaskOverdue(t)).length;
      const gTaskIds = new Set(gTasks.map((t) => t.id));
      const hours = Math.round(
        scopedWorkLogs
          .filter((w) => gTaskIds.has(w.taskId))
          .reduce((s, w) => s + (Number(w.hours) || 0), 0) * 10
      ) / 10;
      const pct = gTasks.length > 0 ? Math.round((done / gTasks.length) * 100) : 0;
      return { group: g, total: gTasks.length, done, overdue, hours, pct };
    });
  }, [groups, scopedTasks, scopedWorkLogs]);

  // Project breakdown (projects in scope + regular tasks bucket)
  const projectRows = useMemo(() => {
    const projectPool = tier === 'SCOPE_MANAGER' && managedProjects.length > 0 ? managedProjects : projects;
    const rows = projectPool.map((p) => {
      const pTasks = scopedTasks.filter((t) => t.projectId === p.id && t.status !== 'HUY');
      const done = pTasks.filter((t) => t.status === 'HOAN_THANH').length;
      const overdue = pTasks.filter((t) => isTaskOverdue(t)).length;
      const pTaskIds = new Set(pTasks.map((t) => t.id));
      const hours = Math.round(
        scopedWorkLogs
          .filter((w) => w.projectId === p.id || pTaskIds.has(w.taskId))
          .reduce((s, w) => s + (Number(w.hours) || 0), 0) * 10
      ) / 10;
      const pct = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : 0;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        total: pTasks.length,
        done,
        overdue,
        hours,
        pct,
        memberCount: p.memberIds.length,
      };
    });

    const regularTasks = scopedTasks.filter((t) => !t.projectId && t.status !== 'HUY');
    if (regularTasks.length > 0) {
      const regIds = new Set(regularTasks.map((t) => t.id));
      const done = regularTasks.filter((t) => t.status === 'HOAN_THANH').length;
      const overdue = regularTasks.filter((t) => isTaskOverdue(t)).length;
      const hours = Math.round(
        scopedWorkLogs
          .filter((w) => !w.projectId && regIds.has(w.taskId))
          .reduce((s, w) => s + (Number(w.hours) || 0), 0) * 10
      ) / 10;
      const pct = Math.round((done / regularTasks.length) * 100);
      rows.push({
        id: 'REGULAR',
        code: 'THƯỜNG XUYÊN',
        name: 'Công việc thường xuyên ngoài dự án',
        total: regularTasks.length,
        done,
        overdue,
        hours,
        pct,
        memberCount: 0,
      });
    }
    return rows.filter((r) => tier !== 'STAFF' || r.total > 0 || r.hours > 0);
  }, [tier, managedProjects, projects, scopedTasks, scopedWorkLogs]);

  // User breakdown (strictly scopedUsers!)
  const userRows = useMemo(() => {
    return scopedUsers
      .filter((u) => u.isActive)
      .map((u) => {
        const uTasks = scopedTasks.filter((t) => t.assigneeId === u.uid && t.status !== 'HUY');
        const done = uTasks.filter((t) => t.status === 'HOAN_THANH').length;
        const overdue = uTasks.filter((t) => isTaskOverdue(t)).length;
        const hours = Math.round(
          scopedWorkLogs
            .filter((w) => w.userId === u.uid)
            .reduce((s, w) => s + (Number(w.hours) || 0), 0) * 10
        ) / 10;
        const pct = uTasks.length > 0 ? Math.round((done / uTasks.length) * 100) : 0;
        return { user: u, total: uTasks.length, done, overdue, hours, pct };
      })
      .filter((r) => r.total > 0 || r.hours > 0)
      .sort((a, b) => b.total - a.total || b.hours - a.hours);
  }, [scopedUsers, scopedTasks, scopedWorkLogs]);

  // Priority / Attention tasks
  const attentionTasks = useMemo(() => {
    const priorityRank: Record<TaskPriority, number> = {
      KHAN_CAP: 0,
      CAO: 1,
      TRUNG_BINH: 2,
      THAP: 3,
    };
    return scopedTasks
      .filter((t) => t.status !== 'HOAN_THANH' && t.status !== 'HUY')
      .slice()
      .sort((a, b) => {
        if (tier === 'DEPARTMENT_HEAD' || tier === 'SCOPE_MANAGER') {
          const aPending = a.status === 'CHO_XAC_NHAN' && canReviewTask(currentUser, a, projects, groups) ? 0 : 1;
          const bPending = b.status === 'CHO_XAC_NHAN' && canReviewTask(currentUser, b, projects, groups) ? 0 : 1;
          if (aPending !== bPending) return aPending - bPending;
        }
        const aOver = isTaskOverdue(a) ? 0 : 1;
        const bOver = isTaskOverdue(b) ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        if (a.status === 'CHUA_HOAN_THANH' && b.status !== 'CHUA_HOAN_THANH') return -1;
        if (b.status === 'CHUA_HOAN_THANH' && a.status !== 'CHUA_HOAN_THANH') return 1;
        const pDiff = priorityRank[a.priority] - priorityRank[b.priority];
        if (pDiff !== 0) return pDiff;
        return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
      })
      .slice(0, 8);
  }, [scopedTasks, tier, currentUser, projects, groups]);

  function resetAllFilters() {
    setFromDate('');
    setToDate('');
    setDateMode('DUE_DATE');
    setGroupId('ALL');
    setProjectId('ALL');
    setAssigneeId('ALL');
  }

  const tierMeta = TIER_META[tier];
  const scopeDescription = useMemo(() => {
    if (tier === 'SYSTEM_ADMIN') {
      return 'Toàn quyền quản trị, giám sát toàn bộ dự án, công việc, nhân sự và dữ liệu hệ thống.';
    }
    if (tier === 'DEPARTMENT_HEAD') {
      return 'Cấp điều hành cao nhất phòng ban · Theo dõi toàn bộ tiến độ nhóm việc, dự án, phê duyệt và nhân sự.';
    }
    if (tier === 'SCOPE_MANAGER') {
      const parts: string[] = [];
      if (managedProjects.length > 0) {
        parts.push(`${managedProjects.length} dự án làm Quản lý dự án`);
      }
      if (groups.length > 0) {
        parts.push(`nhóm ${groups.map((g) => g.name).join(', ')}`);
      }
      return parts.length > 0
        ? `Chỉ hiển thị dữ liệu trong phạm vi bạn quản lý (${parts.join(' · ')}) và việc liên quan trực tiếp.`
        : 'Chỉ hiển thị công việc trong phạm vi bạn được phân công quản lý và việc liên quan trực tiếp.';
    }
    return 'Chỉ hiển thị công việc được giao cho bạn, việc bạn tạo/kiểm tra và nhật ký cá nhân.';
  }, [tier, managedProjects.length, groups]);

  const effectiveBreakdownTab = useMemo(() => {
    if (tier === 'STAFF') return 'PROJECTS' as const;
    if (tier === 'SCOPE_MANAGER' && breakdownTab === 'GROUPS' && groups.length === 0) {
      return 'PROJECTS' as const;
    }
    return breakdownTab;
  }, [tier, breakdownTab, groups.length]);

  return (
    <div className="space-y-4 sm:space-y-5 min-w-0 w-full">
      {/* Role & Scope Header Banner */}
      <div
        className={`bg-white border border-slate-200 border-l-4 ${tierMeta.accentClass} rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0`}
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              {tierMeta.badge}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span className="text-slate-600 truncate">{currentUser.fullName}</span>
          </div>
          <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
            {tierMeta.title}
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">{scopeDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {tier === 'SYSTEM_ADMIN' && onNavigateAdmin && (
            <button
              type="button"
              onClick={onNavigateAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5" />
              Quản trị hệ thống
            </button>
          )}
          {(tier === 'DEPARTMENT_HEAD' || tier === 'SCOPE_MANAGER') && onNavigateProjects && (
            <button
              type="button"
              onClick={onNavigateProjects}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap"
            >
              <FolderKanban className="w-3.5 h-3.5" />
              {tier === 'SCOPE_MANAGER' ? 'Dự án phụ trách' : 'Danh mục dự án'}
            </button>
          )}
        </div>
      </div>

      {/* System Admin Only: System Operational Summary Strip */}
      {tier === 'SYSTEM_ADMIN' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 min-w-0">
          <div className="bg-slate-900 text-white rounded-xl p-3 sm:p-3.5 min-w-0">
            <div className="text-[11px] text-slate-300">Tài khoản đang hoạt động</div>
            <div className="text-lg sm:text-xl font-semibold mt-1 tabular-nums">
              {systemHealth.activeAccounts} / {systemHealth.totalAccounts}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 min-w-0">
            <div className="text-[11px] text-slate-500">Chưa kích hoạt / Đã khóa</div>
            <div className="text-lg sm:text-xl font-semibold text-slate-900 mt-1 tabular-nums">
              {systemHealth.inactiveOrLocked}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 min-w-0">
            <div className="text-[11px] text-slate-500">Nhóm việc đang vận hành</div>
            <div className="text-lg sm:text-xl font-semibold text-slate-900 mt-1 tabular-nums">
              {systemHealth.groupCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 min-w-0">
            <div className="text-[11px] text-slate-500">Dự án đang thực hiện</div>
            <div className="text-lg sm:text-xl font-semibold text-blue-700 mt-1 tabular-nums">
              {systemHealth.runningProjects} / {systemHealth.totalProjects}
            </div>
          </div>
        </div>
      )}

      {/* Scope Manager Only: Managed Projects Quick Strip */}
      {tier === 'SCOPE_MANAGER' && managedProjects.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-900">
              Dự án bạn trực tiếp quản lý ({managedProjects.length})
            </h3>
            <span className="text-[11px] text-slate-500">Bấm vào dự án để lọc nhanh</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 min-w-0">
            {managedProjects.map((prj) => {
              const pTasks = tasks.filter((t) => t.projectId === prj.id && t.status !== 'HUY');
              const done = pTasks.filter((t) => t.status === 'HOAN_THANH').length;
              const overdue = pTasks.filter((t) => isTaskOverdue(t)).length;
              const pct = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : 0;
              const selected = projectId === prj.id;
              return (
                <button
                  key={prj.id}
                  type="button"
                  onClick={() => setProjectId((cur) => (cur === prj.id ? 'ALL' : prj.id))}
                  className={`text-left p-3 rounded-lg border transition-colors space-y-2 min-w-0 ${
                    selected
                      ? 'bg-blue-50/70 border-blue-300'
                      : 'bg-slate-50/50 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-blue-700 truncate">
                      {prj.code}
                    </span>
                    <span className="text-xs font-semibold text-slate-900 tabular-nums shrink-0">
                      {pct}%
                    </span>
                  </div>
                  <div className="text-xs font-medium text-slate-900 truncate">{prj.name}</div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                    <span>
                      {done}/{pTasks.length} việc · {prj.memberIds.length} thành viên
                    </span>
                    {overdue > 0 && (
                      <span className="text-red-700 font-semibold">{overdue} quá hạn</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 space-y-3 min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 min-w-0">
          <div className="w-full lg:w-auto min-w-0">
            <DateRangeFilterBar
              fromDate={fromDate}
              toDate={toDate}
              dateMode={dateMode}
              onFromDateChange={setFromDate}
              onToDateChange={setToDate}
              onDateModeChange={setDateMode}
              onReset={() => {
                setFromDate('');
                setToDate('');
              }}
              includeLast30Days
            />
          </div>

          <div className="flex items-center justify-between lg:justify-end gap-3 text-xs text-slate-500 tabular-nums shrink-0 pt-1 lg:pt-0 border-t border-slate-100 lg:border-t-0">
            <span>
              Tổng hợp <strong className="text-slate-900">{scopedTasks.length}</strong> /{' '}
              {tasks.length} công việc
            </span>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                Đặt lại
              </button>
            )}
          </div>
        </div>

        {(showGroupFilter || showUserFilter || projects.length > 0) && (
          <div
            className={`grid grid-cols-1 ${
              showGroupFilter && showUserFilter
                ? 'sm:grid-cols-3'
                : showUserFilter || showGroupFilter
                ? 'sm:grid-cols-2'
                : 'sm:grid-cols-1'
            } gap-2.5 sm:gap-3 pt-2.5 border-t border-slate-100 min-w-0`}
          >
            {showGroupFilter && (
              <select
                aria-label="Lọc theo nhóm việc"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full min-w-0 max-w-full px-3 py-2 sm:py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="ALL">
                  {tier === 'SCOPE_MANAGER' ? 'Tất cả nhóm phụ trách' : 'Tất cả nhóm việc'}
                </option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} — {g.name}
                  </option>
                ))}
              </select>
            )}

            <select
              aria-label="Lọc theo dự án"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full min-w-0 max-w-full px-3 py-2 sm:py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            >
              <option value="ALL">
                {tier === 'STAFF'
                  ? 'Tất cả việc của tôi (Dự án & Thường xuyên)'
                  : 'Tất cả dự án & việc thường xuyên'}
              </option>
              <option value="REGULAR">Chỉ việc thường xuyên</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>

            {showUserFilter && (
              <select
                aria-label="Lọc theo nhân sự"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full min-w-0 max-w-full px-3 py-2 sm:py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="ALL">
                  {tier === 'SCOPE_MANAGER'
                    ? 'Tất cả nhân sự trong phạm vi'
                    : 'Tất cả nhân sự'}
                </option>
                {scopedUsers
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.fullName} ({u.employeeCode})
                    </option>
                  ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Row 1: Role-Tailored 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 min-w-0">
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col justify-between gap-2 min-w-0">
          <div className="space-y-1">
            <div className="text-[11px] sm:text-xs text-slate-500 leading-snug">
              {tier === 'STAFF'
                ? 'Công việc của tôi (trừ đã hủy)'
                : tier === 'SCOPE_MANAGER'
                ? 'Việc trong phạm vi (trừ đã hủy)'
                : 'Tổng công việc (trừ đã hủy)'}
            </div>
            <div className="text-xl sm:text-2xl font-semibold text-slate-900 tabular-nums">
              {stats.activeTotal}
            </div>
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 tabular-nums leading-snug">
            {stats.total} tất cả · {stats.cancelledCount} đã hủy
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col justify-between gap-2 min-w-0">
          <div className="space-y-1">
            <div className="text-[11px] sm:text-xs text-slate-500 leading-snug">
              {tier === 'STAFF' ? 'Tỷ lệ hoàn thành cá nhân' : 'Tỷ lệ hoàn thành'}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="text-xl sm:text-2xl font-semibold text-emerald-700 tabular-nums">
                {stats.completionRate}%
              </span>
              <span className="text-[11px] sm:text-xs text-slate-500 tabular-nums">
                ({stats.completedCount}/{stats.activeTotal})
              </span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${stats.completionRate}%` }}
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col justify-between gap-2 min-w-0">
          <div className="space-y-1">
            <div className="text-[11px] sm:text-xs text-slate-500 leading-snug">
              {tier === 'DEPARTMENT_HEAD'
                ? 'Chờ lãnh đạo xác nhận'
                : tier === 'SCOPE_MANAGER'
                ? 'Chờ tôi xác nhận'
                : 'Đang xử lý & Chờ duyệt'}
            </div>
            <div
              className={`text-xl sm:text-2xl font-semibold tabular-nums ${
                tier === 'DEPARTMENT_HEAD' || tier === 'SCOPE_MANAGER'
                  ? stats.myReviewQueueCount > 0
                    ? 'text-amber-700'
                    : 'text-blue-700'
                  : 'text-blue-700'
              }`}
            >
              {tier === 'DEPARTMENT_HEAD'
                ? stats.pendingReviewCount
                : tier === 'SCOPE_MANAGER'
                ? stats.myReviewQueueCount
                : stats.inProgressCount + stats.pendingReviewCount}
            </div>
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 tabular-nums leading-snug">
            {stats.inProgressCount} đang làm · {stats.pendingReviewCount} chờ xác nhận
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col justify-between gap-2 min-w-0">
          <div className="space-y-1">
            <div className="text-[11px] sm:text-xs text-slate-500 leading-snug">
              {tier === 'STAFF' ? 'Việc quá hạn của tôi' : 'Công việc quá hạn'}
            </div>
            <div
              className={`text-xl sm:text-2xl font-semibold tabular-nums ${
                stats.overdueCount > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {stats.overdueCount}
            </div>
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 tabular-nums leading-snug">
            {stats.rejectedCount} chưa đạt · {stats.urgentOpenCount} gấp / cao
          </div>
        </div>
      </div>

      {/* Empty State when no tasks match */}
      {scopedTasks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-10 px-4 sm:px-6 text-center space-y-3">
          <p className="text-sm text-slate-600">
            {tier === 'STAFF'
              ? 'Bạn chưa có công việc nào trong khoảng thời gian và điều kiện lọc hiện tại.'
              : 'Không có công việc nào trong phạm vi và điều kiện lọc hiện tại.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {hasAnyFilter && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Xem tất cả thời gian
              </button>
            )}
            <button
              type="button"
              onClick={onCreateTask}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
            >
              Tạo công việc mới
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Row 2: Status/Priority Distribution + Donut & Daily Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch min-w-0">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-5 min-w-0">
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900 truncate">
                    {tier === 'STAFF'
                      ? 'Trạng thái công việc của tôi'
                      : 'Phân bố trạng thái công việc'}
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums shrink-0">
                    {scopedTasks.length} công việc
                  </span>
                </div>

                <div className="space-y-2.5">
                  {statusBreakdown.map((item) => (
                    <div key={item.status} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-700 font-medium truncate">{item.label}</span>
                        <span className="text-slate-600 tabular-nums font-mono shrink-0">
                          {item.count} ({item.pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${STATUS_BAR_COLOR[item.status]} transition-all`}
                          style={{ width: `${item.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 space-y-3 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <h3 className="text-xs font-semibold text-slate-800">
                    Mức độ ưu tiên (trừ việc đã hủy)
                  </h3>
                  <span className="text-[11px] sm:text-xs text-slate-500 tabular-nums">
                    Ước tính {stats.totalEstimatedHours}h · Đã ghi {stats.totalLoggedHours}h
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {priorityBreakdown.map((p) => (
                    <div key={p.priority} className="space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 text-xs">
                        <span className="text-slate-600 truncate">{p.label}</span>
                        <span className="font-semibold text-slate-900 tabular-nums shrink-0">
                          {p.count}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${PRIORITY_BAR_COLOR[p.priority]}`}
                          style={{ width: `${p.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-5 min-w-0">
              <div className="space-y-3 min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">
                  Cơ cấu tiến độ xử lý
                </h2>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 min-w-0">
                  <div className="relative w-28 h-28 shrink-0 self-center sm:self-auto">
                    <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                      <circle
                        cx="60"
                        cy="60"
                        r="46"
                        fill="none"
                        stroke="#F1F5F9"
                        strokeWidth="12"
                      />
                      {donutSegments.map((seg) => (
                        <circle
                          key={seg.key}
                          cx="60"
                          cy="60"
                          r="46"
                          fill="none"
                          stroke={seg.color}
                          strokeWidth="12"
                          strokeDasharray={seg.dasharray}
                          strokeDashoffset={seg.dashoffset}
                          strokeLinecap="butt"
                        />
                      ))}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-semibold text-slate-900 tabular-nums">
                        {stats.completionRate}%
                      </span>
                      <span className="text-[11px] text-slate-500">Đã hoàn thành</span>
                    </div>
                  </div>

                  <div className="w-full sm:flex-1 space-y-2 text-xs min-w-0">
                    {donutSegments.length === 0 ? (
                      <div className="text-slate-500">Chưa có công việc nào (trừ việc đã hủy).</div>
                    ) : (
                      donutSegments.map((seg) => (
                        <div key={seg.key} className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: seg.color }}
                            />
                            <span className="text-slate-700 truncate">{seg.label}</span>
                          </div>
                          <span className="font-mono text-slate-900 tabular-nums shrink-0">
                            {seg.count} ({seg.pct}%)
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 space-y-3 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 text-xs">
                  <span className="font-semibold text-slate-800">
                    {tier === 'STAFF'
                      ? 'Hạn hoàn thành & Giờ làm của tôi theo ngày'
                      : 'Hạn hoàn thành & Giờ làm theo ngày'}
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-500 tabular-nums">
                    Việc đến hạn · Giờ đã ghi
                  </span>
                </div>

                <div className="w-full overflow-x-auto no-scrollbar">
                  <div
                    className={`grid gap-1 items-end h-28 pt-2 ${
                      dailyTrend.buckets.length > 7 ? 'min-w-[330px]' : 'w-full'
                    }`}
                    style={{
                      gridTemplateColumns: `repeat(${dailyTrend.buckets.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {dailyTrend.buckets.map((b) => {
                      const duePct = Math.round((b.dueCount / dailyTrend.maxBar) * 100);
                      const hrsPct = Math.round((b.hours / dailyTrend.maxBar) * 100);
                      return (
                        <div
                          key={b.dateStr}
                          className="flex flex-col items-center justify-end h-full gap-1 min-w-0"
                          title={`${formatDisplayDate(b.dateStr)}: ${b.dueCount} việc đến hạn (${b.doneCount} đã hoàn thành), ${b.hours} giờ nhật ký`}
                        >
                          <div className="flex items-end justify-center gap-0.5 w-full flex-1">
                            <div
                              className="w-2 sm:w-2.5 bg-blue-600 rounded-t-sm transition-all"
                              style={{ height: `${Math.max(b.dueCount > 0 ? 10 : 0, duePct)}%` }}
                            />
                            <div
                              className="w-2 sm:w-2.5 bg-emerald-600 rounded-t-sm transition-all"
                              style={{ height: `${Math.max(b.hours > 0 ? 10 : 0, hrsPct)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-slate-500 tabular-nums truncate w-full text-center">
                            {b.shortLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 shrink-0" />
                      Việc đến hạn
                    </span>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 shrink-0" />
                      Giờ đã ghi
                    </span>
                  </div>
                  <span className="tabular-nums font-medium text-slate-700 shrink-0">
                    Tổng: {stats.totalLoggedHours}h
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Role-Adapted Breakdown Table + Priority / Attention Tasks */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start min-w-0">
            {/* Left Breakdown Card */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 sm:px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  {tier === 'STAFF'
                    ? 'Tiến độ cá nhân theo dự án'
                    : tier === 'SCOPE_MANAGER'
                    ? 'Tiến độ trong phạm vi quản lý'
                    : 'Tiến độ theo đơn vị, dự án & nhân sự'}
                </h2>

                {tier !== 'STAFF' && (
                  <div className="inline-flex p-0.5 bg-slate-100 rounded-lg gap-0.5 shrink-0">
                    {(tier === 'SYSTEM_ADMIN' ||
                      tier === 'DEPARTMENT_HEAD' ||
                      groups.length > 0) && (
                      <button
                        type="button"
                        onClick={() => setBreakdownTab('GROUPS')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          effectiveBreakdownTab === 'GROUPS'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Nhóm việc
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setBreakdownTab('PROJECTS')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        effectiveBreakdownTab === 'PROJECTS'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Dự án
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownTab('USERS')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        effectiveBreakdownTab === 'USERS'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Nhân sự
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile Compact Breakdown List (< md) */}
              <div className="md:hidden divide-y divide-slate-100">
                {effectiveBreakdownTab === 'GROUPS' ? (
                  groupRows.length === 0 ? (
                    <div className="py-8 px-4 text-center text-xs text-slate-500">
                      Chưa có nhóm việc nào trong phạm vi.
                    </div>
                  ) : (
                    groupRows.map((row) => (
                      <button
                        key={row.group.id}
                        type="button"
                        onClick={() =>
                          setGroupId((cur) => (cur === row.group.id ? 'ALL' : row.group.id))
                        }
                        className={`w-full text-left px-3.5 py-3 space-y-2 transition-colors ${
                          groupId === row.group.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {row.group.name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {row.group.code}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-slate-900 tabular-nums shrink-0">
                            {row.pct}%
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-[11px] pt-1 border-t border-slate-100 tabular-nums">
                          <div>
                            <div className="text-slate-400">Tổng</div>
                            <div className="font-medium text-slate-800">{row.total}</div>
                          </div>
                          <div>
                            <div className="text-slate-400">Hoàn thành</div>
                            <div className="font-medium text-emerald-700">{row.done}</div>
                          </div>
                          <div>
                            <div className="text-slate-400">Quá hạn</div>
                            <div
                              className={
                                row.overdue > 0 ? 'font-semibold text-red-700' : 'text-slate-600'
                              }
                            >
                              {row.overdue}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400">Giờ ghi</div>
                            <div className="text-slate-700">{row.hours}h</div>
                          </div>
                        </div>
                      </button>
                    ))
                  )
                ) : effectiveBreakdownTab === 'PROJECTS' ? (
                  projectRows.length === 0 ? (
                    <div className="py-8 px-4 text-center text-xs text-slate-500">
                      Chưa có dự án hoặc công việc nào trong phạm vi.
                    </div>
                  ) : (
                    projectRows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() =>
                          setProjectId((cur) => (cur === row.id ? 'ALL' : row.id))
                        }
                        className={`w-full text-left px-3.5 py-3 space-y-2 transition-colors ${
                          projectId === row.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {row.name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {row.code}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-slate-900 tabular-nums shrink-0">
                            {row.pct}%
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-[11px] pt-1 border-t border-slate-100 tabular-nums">
                          <div>
                            <div className="text-slate-400">Tổng</div>
                            <div className="font-medium text-slate-800">{row.total}</div>
                          </div>
                          <div>
                            <div className="text-slate-400">Hoàn thành</div>
                            <div className="font-medium text-emerald-700">{row.done}</div>
                          </div>
                          <div>
                            <div className="text-slate-400">Quá hạn</div>
                            <div
                              className={
                                row.overdue > 0 ? 'font-semibold text-red-700' : 'text-slate-600'
                              }
                            >
                              {row.overdue}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400">Giờ ghi</div>
                            <div className="text-slate-700">{row.hours}h</div>
                          </div>
                        </div>
                      </button>
                    ))
                  )
                ) : userRows.length === 0 ? (
                  <div className="py-8 px-4 text-center text-xs text-slate-500">
                    Chưa có dữ liệu phân công nhân sự trong phạm vi lọc.
                  </div>
                ) : (
                  userRows.map((row) => (
                    <button
                      key={row.user.uid}
                      type="button"
                      onClick={() =>
                        setAssigneeId((cur) => (cur === row.user.uid ? 'ALL' : row.user.uid))
                      }
                      className={`w-full text-left px-3.5 py-3 space-y-2 transition-colors ${
                        assigneeId === row.user.uid ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {row.user.fullName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {row.user.employeeCode}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-slate-900 tabular-nums shrink-0">
                          {row.pct}%
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[11px] pt-1 border-t border-slate-100 tabular-nums">
                        <div>
                          <div className="text-slate-400">Tổng</div>
                          <div className="font-medium text-slate-800">{row.total}</div>
                        </div>
                        <div>
                          <div className="text-slate-400">Hoàn thành</div>
                          <div className="font-medium text-emerald-700">{row.done}</div>
                        </div>
                        <div>
                          <div className="text-slate-400">Quá hạn</div>
                          <div
                            className={
                              row.overdue > 0 ? 'font-semibold text-red-700' : 'text-slate-600'
                            }
                          >
                            {row.overdue}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400">Giờ ghi</div>
                          <div className="text-slate-700">{row.hours}h</div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {/* Desktop Breakdown Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                {effectiveBreakdownTab === 'GROUPS' ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Nhóm việc</th>
                        <th className="py-2.5 px-3 text-right">Tổng</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đã hoàn thành</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Quá hạn</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Giờ đã ghi</th>
                        <th className="py-2.5 px-4 text-right">Tỷ lệ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {groupRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                            Chưa có nhóm việc nào trong phạm vi.
                          </td>
                        </tr>
                      ) : (
                        groupRows.map((row) => (
                          <tr
                            key={row.group.id}
                            onClick={() =>
                              setGroupId((cur) =>
                                cur === row.group.id ? 'ALL' : row.group.id
                              )
                            }
                            className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                              groupId === row.group.id ? 'bg-blue-50/50' : ''
                            }`}
                          >
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{row.group.name}</div>
                              <div className="font-mono text-[11px] text-slate-500">
                                {row.group.code}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-800">
                              {row.total}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700 font-medium">
                              {row.done}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right tabular-nums ${
                                row.overdue > 0 ? 'text-red-700 font-semibold' : 'text-slate-500'
                              }`}
                            >
                              {row.overdue}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                              {row.hours}h
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-medium text-slate-900">
                              {row.pct}%
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : effectiveBreakdownTab === 'PROJECTS' ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Dự án / Hạng mục</th>
                        <th className="py-2.5 px-3 text-right">Tổng</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đã hoàn thành</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Quá hạn</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Giờ đã ghi</th>
                        <th className="py-2.5 px-4 text-right">Tỷ lệ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {projectRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                            Chưa có dự án hoặc công việc nào trong phạm vi.
                          </td>
                        </tr>
                      ) : (
                        projectRows.map((row) => (
                          <tr
                            key={row.id}
                            onClick={() =>
                              setProjectId((cur) => (cur === row.id ? 'ALL' : row.id))
                            }
                            className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                              projectId === row.id ? 'bg-blue-50/50' : ''
                            }`}
                          >
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{row.name}</div>
                              <div className="font-mono text-[11px] text-slate-500">
                                {row.code}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-800">
                              {row.total}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700 font-medium">
                              {row.done}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right tabular-nums ${
                                row.overdue > 0 ? 'text-red-700 font-semibold' : 'text-slate-500'
                              }`}
                            >
                              {row.overdue}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                              {row.hours}h
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-medium text-slate-900">
                              {row.pct}%
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Nhân sự</th>
                        <th className="py-2.5 px-3 text-right">Tổng</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đã hoàn thành</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Quá hạn</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Giờ đã ghi</th>
                        <th className="py-2.5 px-4 text-right">Tỷ lệ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {userRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                            Chưa có dữ liệu phân công nhân sự trong phạm vi lọc.
                          </td>
                        </tr>
                      ) : (
                        userRows.map((row) => (
                          <tr
                            key={row.user.uid}
                            onClick={() =>
                              setAssigneeId((cur) =>
                                cur === row.user.uid ? 'ALL' : row.user.uid
                              )
                            }
                            className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                              assigneeId === row.user.uid ? 'bg-blue-50/50' : ''
                            }`}
                          >
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{row.user.fullName}</div>
                              <div className="font-mono text-[11px] text-slate-500">
                                {row.user.employeeCode}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-800">
                              {row.total}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700 font-medium">
                              {row.done}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right tabular-nums ${
                                row.overdue > 0 ? 'text-red-700 font-semibold' : 'text-slate-500'
                              }`}
                            >
                              {row.overdue}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                              {row.hours}h
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-medium text-slate-900">
                              {row.pct}%
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Priority / Overdue Action List */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden min-w-0">
              <div className="flex items-center justify-between gap-2 px-3.5 sm:px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900 truncate">
                  {tier === 'STAFF'
                    ? 'Việc của tôi cần ưu tiên'
                    : tier === 'DEPARTMENT_HEAD' || tier === 'SCOPE_MANAGER'
                    ? 'Chờ xác nhận & Ưu tiên xử lý'
                    : 'Công việc ưu tiên theo dõi'}
                </h2>
                <button
                  type="button"
                  onClick={onNavigateList}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
                >
                  Xem danh sách
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {attentionTasks.length === 0 ? (
                <div className="py-8 px-4 text-center text-xs text-slate-500">
                  Tất cả công việc trong phạm vi lọc đã hoàn thành.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {attentionTasks.map((task) => {
                    const assignee = allUsers.find((u) => u.uid === task.assigneeId);
                    const overdue = isTaskOverdue(task);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onSelectTask(task)}
                        className="w-full text-left px-3.5 sm:px-4 py-3 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5 sm:gap-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2 sm:justify-start">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 min-w-0">
                              <span className="font-mono font-medium text-blue-700 shrink-0">
                                {task.code}
                              </span>
                              <span aria-hidden="true">·</span>
                              <PriorityLabel priority={task.priority} />
                              {tier !== 'STAFF' && (
                                <>
                                  <span className="hidden sm:inline" aria-hidden="true">
                                    ·
                                  </span>
                                  <span className="hidden sm:inline truncate">
                                    {assignee?.fullName || '—'}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="sm:hidden shrink-0">
                              <TaskStatusLabel status={task.status} isOverdue={overdue} />
                            </div>
                          </div>
                          <div className="text-sm font-medium text-slate-900 line-clamp-2 sm:line-clamp-1">
                            {task.title}
                          </div>
                          <div className="sm:hidden flex items-center justify-between gap-2 text-xs text-slate-500">
                            <span className="truncate">
                              {tier === 'STAFF'
                                ? projects.find((p) => p.id === task.projectId)?.code || 'Thường xuyên'
                                : assignee?.fullName || '—'}
                            </span>
                            <span
                              className={`tabular-nums shrink-0 ${
                                overdue ? 'text-red-700 font-semibold' : 'text-slate-500'
                              }`}
                            >
                              {formatDisplayDate(task.dueDate)}
                            </span>
                          </div>
                        </div>

                        <div className="hidden sm:block text-right shrink-0 space-y-1">
                          <div>
                            <TaskStatusLabel status={task.status} isOverdue={overdue} />
                          </div>
                          <div
                            className={`text-xs tabular-nums ${
                              overdue ? 'text-red-700 font-semibold' : 'text-slate-500'
                            }`}
                          >
                            {formatDisplayDate(task.dueDate)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
