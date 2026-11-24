import { useMemo, useState } from 'react';
import { CheckCheck, Clock, Send, ShieldAlert } from 'lucide-react';
import { Project, TaskItem, UserProfile, WorkGroup } from '../types/domain';
import { batchApproveTasks } from '../lib/firestoreService';
import { canReviewTask } from '../lib/rbac';
import { formatDisplayDate, isTaskOverdue } from '../lib/time';
import { PriorityLabel, TaskStatusLabel } from './StatusText';

interface MyWorkspaceViewProps {
  currentUser: UserProfile;
  tasks: TaskItem[];
  users: UserProfile[];
  groups: WorkGroup[];
  projects: Project[];
  onSelectTask: (task: TaskItem) => void;
  onCreateTask: () => void;
  onNotify: (msg: string) => void;
}

export function MyWorkspaceView({
  currentUser,
  tasks,
  users,
  projects,
  onSelectTask,
  onCreateTask,
  onNotify,
}: MyWorkspaceViewProps) {
  const [tab, setTab] = useState<'MY_TASKS' | 'ASSIGNED_BY_ME' | 'PENDING_REVIEW' | 'OVERDUE'>(
    'MY_TASKS'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);

  const myTasks = useMemo(
    () => tasks.filter((t) => t.assigneeId === currentUser.uid && t.status !== 'HUY'),
    [tasks, currentUser.uid]
  );

  const assignedByMe = useMemo(
    () =>
      tasks.filter(
        (t) => t.creatorId === currentUser.uid && t.assigneeId !== currentUser.uid
      ),
    [tasks, currentUser.uid]
  );

  const pendingReview = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === 'CHO_XAC_NHAN' &&
          canReviewTask(currentUser, t, projects)
      ),
    [tasks, currentUser, projects]
  );

  const overdueTasks = useMemo(
    () => tasks.filter((t) => isTaskOverdue(t)),
    [tasks]
  );

  const activeList =
    tab === 'MY_TASKS'
      ? myTasks
      : tab === 'ASSIGNED_BY_ME'
      ? assignedByMe
      : tab === 'PENDING_REVIEW'
      ? pendingReview
      : overdueTasks;

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleBatchApprove() {
    const targets = pendingReview.filter((t) => selectedIds.includes(t.id));
    if (targets.length === 0) return;
    setBatching(true);
    try {
      await batchApproveTasks(targets, currentUser);
      setSelectedIds([]);
      onNotify(`Đã duyệt hoàn thành hàng loạt ${targets.length} công việc.`);
    } finally {
      setBatching(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Việc của tôi</div>
          <div className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
            {myTasks.filter((t) => t.status !== 'HOAN_THANH').length}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            Tổng {myTasks.length} nhiệm vụ
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Việc tôi đã giao</div>
          <div className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
            {assignedByMe.length}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {assignedByMe.filter((t) => t.status === 'HOAN_THANH').length} đã hoàn thành
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Chờ tôi xác nhận</div>
          <div className="text-2xl font-semibold text-amber-700 mt-1 tabular-nums">
            {pendingReview.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">Cần kiểm tra & duyệt</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Công việc quá hạn</div>
          <div className="text-2xl font-semibold text-red-700 mt-1 tabular-nums">
            {overdueTasks.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">Theo hạn hoàn thành</div>
        </div>
      </div>

      {/* Tabs + Batch action */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setTab('MY_TASKS');
                setSelectedIds([]);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'MY_TASKS'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              Việc của tôi ({myTasks.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('ASSIGNED_BY_ME');
                setSelectedIds([]);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'ASSIGNED_BY_ME'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              Việc tôi đã giao ({assignedByMe.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('PENDING_REVIEW');
                setSelectedIds([]);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'PENDING_REVIEW'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Chờ tôi xác nhận ({pendingReview.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('OVERDUE');
                setSelectedIds([]);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'OVERDUE'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Quá hạn ({overdueTasks.length})
            </button>
          </div>

          {tab === 'PENDING_REVIEW' && selectedIds.length > 0 && (
            <button
              type="button"
              disabled={batching}
              onClick={handleBatchApprove}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 whitespace-nowrap"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {batching ? 'Đang duyệt...' : `Duyệt hoàn thành (${selectedIds.length})`}
            </button>
          )}
        </div>

        {activeList.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <p className="text-sm text-slate-600">
              Không có công việc nào trong mục này.
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
                  {tab === 'PENDING_REVIEW' && (
                    <th className="py-2.5 pl-4 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={
                          pendingReview.length > 0 &&
                          selectedIds.length === pendingReview.length
                        }
                        onChange={(e) =>
                          setSelectedIds(
                            e.target.checked ? pendingReview.map((t) => t.id) : []
                          )
                        }
                        aria-label="Chọn tất cả"
                      />
                    </th>
                  )}
                  <th className="py-2.5 px-4">Mã</th>
                  <th className="py-2.5 px-4">Công việc</th>
                  <th className="py-2.5 px-4">Người thực hiện</th>
                  <th className="py-2.5 px-4">Ưu tiên</th>
                  <th className="py-2.5 px-4">Trạng thái</th>
                  <th className="py-2.5 px-4 text-right">Hạn hoàn thành</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {activeList.map((task) => {
                  const assignee = users.find((u) => u.uid === task.assigneeId);
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
                      {tab === 'PENDING_REVIEW' && (
                        <td
                          className="py-2.5 pl-4 pr-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(task.id)}
                            onChange={() => toggleSelect(task.id)}
                          />
                        </td>
                      )}
                      <td className="py-2.5 px-4 font-mono text-xs font-medium text-blue-700 whitespace-nowrap">
                        {task.code}
                      </td>
                      <td className="py-2.5 px-4 min-w-[220px]">
                        <div className="font-medium text-slate-900 line-clamp-1">
                          {task.title}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {project ? `${project.code} · ${project.name}` : 'Việc thường xuyên'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700 whitespace-nowrap">
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
