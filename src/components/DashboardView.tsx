import { useMemo, useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
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
  tasks: TaskItem[];
  projects: Project[];
  users: UserProfile[];
  groups: WorkGroup[];
  workLogs: WorkLog[];
  onSelectTask: (task: TaskItem) => void;
  onNavigateList: () => void;
  onCreateTask: () => void;
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

export function DashboardView({
  tasks,
  projects,
  users,
  groups,
  workLogs,
  onSelectTask,
  onNavigateList,
  onCreateTask,
}: DashboardViewProps) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateMode, setDateMode] = useState<TaskDateFilterMode>('DUE_DATE');
  const [groupId, setGroupId] = useState('ALL');
  const [projectId, setProjectId] = useState('ALL');
  const [assigneeId, setAssigneeId] = useState('ALL');
  const [breakdownTab, setBreakdownTab] = useState<'GROUPS' | 'USERS'>('GROUPS');

  const hasAnyFilter = Boolean(
    fromDate || toDate || groupId !== 'ALL' || projectId !== 'ALL' || assigneeId !== 'ALL'
  );

  const scopedTasks = useMemo(() => {
    const byDate = filterTasksByDateRange(tasks, fromDate, toDate, dateMode);
    return byDate.filter((t) => {
      if (groupId !== 'ALL' && t.groupId !== groupId) return false;
      if (projectId === 'REGULAR' && t.projectId) return false;
      if (projectId !== 'ALL' && projectId !== 'REGULAR' && t.projectId !== projectId) return false;
      if (assigneeId !== 'ALL' && t.assigneeId !== assigneeId) return false;
      return true;
    });
  }, [tasks, fromDate, toDate, dateMode, groupId, projectId, assigneeId]);

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
      if (assigneeId !== 'ALL' && wl.userId !== assigneeId) return false;
      if (projectId === 'REGULAR' && wl.projectId) return false;
      if (projectId !== 'ALL' && projectId !== 'REGULAR' && wl.projectId !== projectId) {
        return false;
      }
      if (groupId !== 'ALL' && !scopedTaskIds.has(wl.taskId)) {
        const taskOwner = users.find((u) => u.uid === wl.userId);
        if (!taskOwner || taskOwner.groupId !== groupId) return false;
      }
      return true;
    });
  }, [workLogs, fromDate, toDate, assigneeId, projectId, groupId, scopedTasks, users]);

  const stats = useMemo(() => {
    const nonCancelled = scopedTasks.filter((t) => t.status !== 'HUY');
    const cancelledCount = scopedTasks.length - nonCancelled.length;
    const completedCount = nonCancelled.filter((t) => t.status === 'HOAN_THANH').length;
    const inProgressCount = nonCancelled.filter(
      (t) => t.status === 'DANG_THUC_HIEN' || t.status === 'MOI'
    ).length;
    const pendingReviewCount = nonCancelled.filter((t) => t.status === 'CHO_XAC_NHAN').length;
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
      rejectedCount,
      overdueCount,
      urgentOpenCount,
      completionRate,
      totalLoggedHours,
      totalEstimatedHours,
    };
  }, [scopedTasks, scopedWorkLogs]);

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

  // SVG Donut segments (non-cancelled tasks)
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

  // Daily trend (last 7 days or selected window up to 10 days)
  const dailyTrend = useMemo(() => {
    const { dateStr: today } = getVietnamNowParts();
    const rawFrom = fromDate.trim();
    const rawTo = toDate.trim();
    const hasBoth = Boolean(rawFrom && rawTo);
    const effTo = (hasBoth && rawFrom > rawTo ? rawFrom : rawTo) || today;
    const effFrom =
      (hasBoth && rawFrom > rawTo ? rawTo : rawFrom) || shiftDateStr(effTo, -6);

    // Build up to 10 daily buckets ending at effTo (or from effFrom..effTo if <= 10 days)
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

  // Group breakdown
  const groupRows = useMemo(() => {
    return groups.map((g) => {
      const gTasks = scopedTasks.filter((t) => t.groupId === g.id && t.status !== 'HUY');
      const done = gTasks.filter((t) => t.status === 'HOAN_THANH').length;
      const active = gTasks.filter(
        (t) => t.status === 'DANG_THUC_HIEN' || t.status === 'MOI' || t.status === 'CHO_XAC_NHAN'
      ).length;
      const overdue = gTasks.filter((t) => isTaskOverdue(t)).length;
      const gTaskIds = new Set(gTasks.map((t) => t.id));
      const hours = Math.round(
        scopedWorkLogs
          .filter((w) => gTaskIds.has(w.taskId))
          .reduce((s, w) => s + (Number(w.hours) || 0), 0) * 10
      ) / 10;
      const pct = gTasks.length > 0 ? Math.round((done / gTasks.length) * 100) : 0;
      return { group: g, total: gTasks.length, done, active, overdue, hours, pct };
    });
  }, [groups, scopedTasks, scopedWorkLogs]);

  // User breakdown
  const userRows = useMemo(() => {
    return users
      .filter((u) => u.isActive)
      .map((u) => {
        const uTasks = scopedTasks.filter((t) => t.assigneeId === u.uid && t.status !== 'HUY');
        const done = uTasks.filter((t) => t.status === 'HOAN_THANH').length;
        const active = uTasks.filter(
          (t) => t.status === 'DANG_THUC_HIEN' || t.status === 'MOI' || t.status === 'CHO_XAC_NHAN'
        ).length;
        const overdue = uTasks.filter((t) => isTaskOverdue(t)).length;
        const hours = Math.round(
          scopedWorkLogs
            .filter((w) => w.userId === u.uid)
            .reduce((s, w) => s + (Number(w.hours) || 0), 0) * 10
        ) / 10;
        const pct = uTasks.length > 0 ? Math.round((done / uTasks.length) * 100) : 0;
        return { user: u, total: uTasks.length, done, active, overdue, hours, pct };
      })
      .filter((r) => r.total > 0 || r.hours > 0)
      .sort((a, b) => b.total - a.total || b.hours - a.hours);
  }, [users, scopedTasks, scopedWorkLogs]);

  // Attention tasks (overdue, rejected, pending review, high/urgent open)
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
  }, [scopedTasks]);

  function resetAllFilters() {
    setFromDate('');
    setToDate('');
    setDateMode('DUE_DATE');
    setGroupId('ALL');
    setProjectId('ALL');
    setAssigneeId('ALL');
  }

  return (
    <div className="space-y-5">
      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
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

          <div className="flex items-center gap-3 text-xs text-slate-500 tabular-nums">
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2.5 border-t border-slate-100">
          <select
            aria-label="Lọc theo nhóm việc"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="ALL">Tất cả nhóm việc</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} — {g.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo dự án"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="ALL">Tất cả dự án & việc thường xuyên</option>
            <option value="REGULAR">Chỉ việc thường xuyên</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo nhân sự"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="ALL">Tất cả nhân sự</option>
            {users
              .filter((u) => u.isActive)
              .map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.fullName} ({u.employeeCode})
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Row 1: 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
          <div className="text-xs text-slate-500">Tổng công việc (trừ đã hủy)</div>
          <div className="text-2xl font-semibold text-slate-900 tabular-nums">
            {stats.activeTotal}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            {stats.total} tất cả · {stats.cancelledCount} đã hủy
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
          <div className="text-xs text-slate-500">Tỷ lệ hoàn thành</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-emerald-700 tabular-nums">
              {stats.completionRate}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              ({stats.completedCount}/{stats.activeTotal})
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${stats.completionRate}%` }}
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
          <div className="text-xs text-slate-500">Đang thực hiện & Chờ xác nhận</div>
          <div className="text-2xl font-semibold text-blue-700 tabular-nums">
            {stats.inProgressCount + stats.pendingReviewCount}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            {stats.inProgressCount} mới / đang thực hiện · {stats.pendingReviewCount} chờ xác nhận
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
          <div className="text-xs text-slate-500">Công việc quá hạn</div>
          <div
            className={`text-2xl font-semibold tabular-nums ${
              stats.overdueCount > 0 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {stats.overdueCount}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            {stats.rejectedCount} chưa hoàn thành · {stats.urgentOpenCount} ưu tiên cao / khẩn cấp
          </div>
        </div>
      </div>

      {/* Empty State when no tasks match */}
      {scopedTasks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 px-6 text-center space-y-3">
          <p className="text-sm text-slate-600">
            Không có công việc nào trong khoảng thời gian và điều kiện lọc hiện tại.
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Left: Status & Priority */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Phân bố trạng thái công việc
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {scopedTasks.length} công việc
                  </span>
                </div>

                <div className="space-y-2.5">
                  {statusBreakdown.map((item) => (
                    <div key={item.status} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-700 font-medium">{item.label}</span>
                        <span className="text-slate-600 tabular-nums font-mono">
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

              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-800">
                    Mức độ ưu tiên (trừ việc đã hủy)
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    Ước tính {stats.totalEstimatedHours} giờ · Đã ghi {stats.totalLoggedHours} giờ
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {priorityBreakdown.map((p) => (
                    <div key={p.priority} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">{p.label}</span>
                        <span className="font-semibold text-slate-900 tabular-nums">
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

            {/* Right: Donut Progress + Daily Activity SVG Chart */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-5">
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Cơ cấu tiến độ xử lý
                </h2>
                <div className="flex items-center gap-5">
                  <div className="relative w-28 h-28 shrink-0">
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

                  <div className="flex-1 space-y-2 text-xs">
                    {donutSegments.length === 0 ? (
                      <div className="text-slate-500">Chưa có công việc nào (trừ việc đã hủy).</div>
                    ) : (
                      donutSegments.map((seg) => (
                        <div key={seg.key} className="flex items-center justify-between gap-2">
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

              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    Hạn hoàn thành & Giờ làm theo ngày
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    Việc đến hạn · Giờ đã ghi
                  </span>
                </div>

                <div className="grid gap-1.5 items-end h-28 pt-2" style={{
                  gridTemplateColumns: `repeat(${dailyTrend.buckets.length}, minmax(0, 1fr))`,
                }}>
                  {dailyTrend.buckets.map((b) => {
                    const duePct = Math.round((b.dueCount / dailyTrend.maxBar) * 100);
                    const hrsPct = Math.round((b.hours / dailyTrend.maxBar) * 100);
                    return (
                      <div
                        key={b.dateStr}
                        className="flex flex-col items-center justify-end h-full gap-1"
                        title={`${formatDisplayDate(b.dateStr)}: ${b.dueCount} việc đến hạn (${b.doneCount} đã hoàn thành), ${b.hours} giờ nhật ký`}
                      >
                        <div className="flex items-end justify-center gap-0.5 w-full flex-1">
                          <div
                            className="w-2.5 bg-blue-600 rounded-t-sm transition-all"
                            style={{ height: `${Math.max(b.dueCount > 0 ? 10 : 0, duePct)}%` }}
                          />
                          <div
                            className="w-2.5 bg-emerald-600 rounded-t-sm transition-all"
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

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />
                      Việc đến hạn
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" />
                      Giờ đã ghi
                    </span>
                  </div>
                  <span className="tabular-nums font-medium text-slate-700">
                    Tổng: {stats.totalLoggedHours}h
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Breakdown Table + Attention Tasks */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Group / Member Performance */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  Tiến độ theo đơn vị & nhân sự
                </h2>
                <div className="inline-flex p-0.5 bg-slate-100 rounded-lg gap-0.5">
                  <button
                    type="button"
                    onClick={() => setBreakdownTab('GROUPS')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      breakdownTab === 'GROUPS'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Nhóm việc
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreakdownTab('USERS')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      breakdownTab === 'USERS'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Nhân sự
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                {breakdownTab === 'GROUPS' ? (
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
                            Chưa có nhóm việc nào.
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
                            Chưa có dữ liệu phân công nhân sự trong khoảng lọc.
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
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  Công việc ưu tiên theo dõi
                </h2>
                <button
                  type="button"
                  onClick={onNavigateList}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
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
                    const assignee = users.find((u) => u.uid === task.assigneeId);
                    const overdue = isTaskOverdue(task);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onSelectTask(task)}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="font-mono font-medium text-blue-700">
                              {task.code}
                            </span>
                            <span aria-hidden="true">·</span>
                            <PriorityLabel priority={task.priority} />
                            <span aria-hidden="true">·</span>
                            <span>{assignee?.fullName || '—'}</span>
                          </div>
                          <div className="text-sm font-medium text-slate-900 line-clamp-1">
                            {task.title}
                          </div>
                        </div>

                        <div className="text-right shrink-0 space-y-1">
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
