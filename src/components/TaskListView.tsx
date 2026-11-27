import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  PRIORITY_LABELS,
  Project,
  TASK_STATUS_LABELS,
  TaskItem,
  TaskPriority,
  TaskStatus,
  UserProfile,
  WorkGroup,
} from '../types/domain';
import {
  filterTasksByDateRange,
  formatDisplayDate,
  isTaskOverdue,
  TaskDateFilterMode,
} from '../lib/time';
import { DateRangeFilterBar } from './DateRangeFilterBar';
import { PriorityLabel, TaskStatusLabel } from './StatusText';

interface TaskListViewProps {
  tasks: TaskItem[];
  users: UserProfile[];
  groups: WorkGroup[];
  projects: Project[];
  onSelectTask: (task: TaskItem) => void;
  onCreateTask: () => void;
}

export function TaskListView({
  tasks,
  users,
  groups,
  projects,
  onSelectTask,
  onCreateTask,
}: TaskListViewProps) {
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('ALL');
  const [groupId, setGroupId] = useState('ALL');
  const [assigneeId, setAssigneeId] = useState('ALL');
  const [status, setStatus] = useState<string>('ALL');
  const [priority, setPriority] = useState<string>('ALL');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateMode, setDateMode] = useState<TaskDateFilterMode>('DUE_DATE');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const dateMatched = filterTasksByDateRange(tasks, fromDate, toDate, dateMode);
    return dateMatched.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q) && !t.code.toLowerCase().includes(q)) {
        return false;
      }
      if (projectId === 'REGULAR' && t.projectId) return false;
      if (projectId !== 'ALL' && projectId !== 'REGULAR' && t.projectId !== projectId) return false;
      if (groupId !== 'ALL' && t.groupId !== groupId) return false;
      if (assigneeId !== 'ALL' && t.assigneeId !== assigneeId) return false;
      if (status !== 'ALL' && t.status !== status) return false;
      if (priority !== 'ALL' && t.priority !== priority) return false;
      if (onlyOverdue && !isTaskOverdue(t)) return false;
      return true;
    });
  }, [
    tasks,
    search,
    projectId,
    groupId,
    assigneeId,
    status,
    priority,
    onlyOverdue,
    fromDate,
    toDate,
    dateMode,
  ]);

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo mã việc hoặc tiêu đề..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="ALL">Tất cả dự án</option>
            <option value="REGULAR">Việc thường xuyên</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>

          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="ALL">Tất cả nhóm việc</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="ALL">Tất cả nhân sự</option>
            {users.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.fullName}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="ALL">Tất cả trạng thái</option>
            {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((st) => (
              <option key={st} value={st}>
                {TASK_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </div>

        <div className="pt-2 border-t border-slate-100">
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
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Ưu tiên:</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-md"
              >
                <option value="ALL">Tất cả</option>
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyOverdue}
                onChange={(e) => setOnlyOverdue(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>Chỉ hiện việc quá hạn</span>
            </label>
          </div>

          <span className="text-slate-500 tabular-nums">
            Hiển thị {filtered.length} / {tasks.length} công việc
          </span>
        </div>
      </div>

      {/* High-density Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <p className="text-sm text-slate-600">
              Không tìm thấy công việc phù hợp với bộ lọc hiện tại.
            </p>
            <button
              type="button"
              onClick={onCreateTask}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
            >
              Tạo công việc mới
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Mã việc</th>
                  <th className="py-2.5 px-4">Tiêu đề & Dự án</th>
                  <th className="py-2.5 px-4">Nhóm</th>
                  <th className="py-2.5 px-4">Người thực hiện</th>
                  <th className="py-2.5 px-4">Ưu tiên</th>
                  <th className="py-2.5 px-4">Trạng thái</th>
                  <th className="py-2.5 px-4 text-right">Hạn hoàn thành</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((task) => {
                  const assignee = users.find((u) => u.uid === task.assigneeId);
                  const group = groups.find((g) => g.id === task.groupId);
                  const project = task.projectId
                    ? projects.find((p) => p.id === task.projectId)
                    : null;
                  const overdue = isTaskOverdue(task);

                  return (
                    <tr
                      key={task.id}
                      onClick={() => onSelectTask(task)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono text-xs font-medium text-blue-700 whitespace-nowrap">
                        {task.code}
                      </td>
                      <td className="py-2.5 px-4 min-w-[240px]">
                        <div className="font-medium text-slate-900 line-clamp-1">
                          {task.title}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {project ? `${project.code} · ${project.name}` : 'Việc thường xuyên'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {group?.code || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-800 whitespace-nowrap">
                        {assignee?.fullName || '—'}
                      </td>
                      <td className="py-2.5 px-4">
                        <PriorityLabel priority={task.priority} />
                      </td>
                      <td className="py-2.5 px-4">
                        <TaskStatusLabel status={task.status} isOverdue={overdue} />
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right text-xs tabular-nums whitespace-nowrap ${
                          overdue ? 'text-red-700 font-semibold' : 'text-slate-600'
                        }`}
                      >
                        {formatDisplayDate(task.dueDate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
