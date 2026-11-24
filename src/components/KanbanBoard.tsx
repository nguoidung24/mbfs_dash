import React, { useState } from 'react';
import { AlertCircle, Lock } from 'lucide-react';
import {
  KANBAN_COLUMNS,
  Project,
  TASK_STATUS_LABELS,
  TaskItem,
  TaskStatus,
  UserProfile,
} from '../types/domain';
import { reviewTaskDecision, updateTaskProgressOrSubmit } from '../lib/firestoreService';
import { canReviewTask } from '../lib/rbac';
import { formatDisplayDate, isTaskOverdue } from '../lib/time';
import { PriorityLabel } from './StatusText';

interface KanbanBoardProps {
  tasks: TaskItem[];
  users: UserProfile[];
  projects: Project[];
  currentUser: UserProfile;
  onSelectTask: (task: TaskItem) => void;
  onNotify: (msg: string) => void;
}

export function KanbanBoard({
  tasks,
  users,
  projects,
  currentUser,
  onSelectTask,
  onNotify,
}: KanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);
  const [errorBanner, setErrorBanner] = useState('');

  // Modal prompt when dragging into CHO_XAC_NHAN or CHUA_HOAN_THANH
  const [pendingTransition, setPendingTransition] = useState<{
    task: TaskItem;
    targetStatus: TaskStatus;
  } | null>(null);
  const [transitionNote, setTransitionNote] = useState('');

  async function attemptMove(task: TaskItem, targetStatus: TaskStatus) {
    setErrorBanner('');
    if (task.status === targetStatus) return;

    if (task.isLocked) {
      setErrorBanner(
        `Công việc ${task.code} đã hoàn thành và bị khóa. Chỉ cấp trên mới có thể mở lại từ màn hình chi tiết.`
      );
      return;
    }

    const isReviewer = canReviewTask(currentUser, task, projects);
    const isAssignee = task.assigneeId === currentUser.uid;

    if (targetStatus === 'HOAN_THANH') {
      if (!isReviewer) {
        setErrorBanner(
          'Chuyên viên không được tự chuyển công việc sang "Đã hoàn thành". Vui lòng chuyển sang "Chờ xác nhận" để nộp kết quả.'
        );
        return;
      }
      await reviewTaskDecision({
        task,
        actor: currentUser,
        decision: 'APPROVE',
      });
      onNotify(`Đã xác nhận hoàn thành ${task.code}.`);
      return;
    }

    if (targetStatus === 'CHUA_HOAN_THANH') {
      if (!isReviewer) {
        setErrorBanner('Chỉ cấp trên / người xác nhận mới được trả lại trạng thái "Chưa hoàn thành".');
        return;
      }
      setPendingTransition({ task, targetStatus });
      setTransitionNote('');
      return;
    }

    if (targetStatus === 'CHO_XAC_NHAN') {
      if (!isAssignee && !isReviewer) {
        setErrorBanner('Bạn không có quyền nộp kết quả cho công việc này.');
        return;
      }
      setPendingTransition({ task, targetStatus });
      setTransitionNote('');
      return;
    }

    // MOI / DANG_THUC_HIEN / TAM_HOAN
    if (!isAssignee && !isReviewer) {
      setErrorBanner('Bạn không có quyền thay đổi trạng thái công việc này.');
      return;
    }

    await updateTaskProgressOrSubmit({
      task,
      actor: currentUser,
      nextStatus: targetStatus as 'MOI' | 'DANG_THUC_HIEN' | 'TAM_HOAN',
    });
    onNotify(`Đã chuyển ${task.code} sang "${TASK_STATUS_LABELS[targetStatus]}".`);
  }

  async function submitTransitionPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingTransition) return;
    const { task, targetStatus } = pendingTransition;
    if (targetStatus === 'CHUA_HOAN_THANH') {
      if (transitionNote.trim().length < 3) {
        setErrorBanner('Bắt buộc nhập lý do chưa hoàn thành (tối thiểu 3 ký tự).');
        return;
      }
      await reviewTaskDecision({
        task,
        actor: currentUser,
        decision: 'REJECT',
        note: transitionNote.trim(),
      });
      onNotify(`Đã trả lại ${task.code} để thực hiện bổ sung.`);
    } else if (targetStatus === 'CHO_XAC_NHAN') {
      await updateTaskProgressOrSubmit({
        task,
        actor: currentUser,
        nextStatus: 'CHO_XAC_NHAN',
        submissionNote: transitionNote.trim() || 'Đã hoàn thành và nộp kết quả',
      });
      onNotify(`Đã nộp kết quả ${task.code} chờ xác nhận.`);
    }
    setPendingTransition(null);
    setTransitionNote('');
  }

  return (
    <div className="space-y-4">
      {errorBanner && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner('')}
            className="text-red-700 font-medium hover:underline shrink-0"
          >
            Đóng
          </button>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4 items-start">
        {KANBAN_COLUMNS.map((colStatus) => {
          const colTasks = tasks.filter((t) => t.status === colStatus);
          const isDragOver = dragOverCol === colStatus;

          return (
            <div
              key={colStatus}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(colStatus);
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCol(null);
                const taskId = e.dataTransfer.getData('text/plain') || draggingId;
                setDraggingId(null);
                const found = tasks.find((t) => t.id === taskId);
                if (found) attemptMove(found, colStatus);
              }}
              className={`w-[280px] shrink-0 rounded-xl border transition-colors ${
                isDragOver
                  ? 'bg-blue-50/60 border-blue-400'
                  : 'bg-slate-100/70 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-200/80">
                <span className="text-xs font-semibold text-slate-800">
                  {TASK_STATUS_LABELS[colStatus]}
                </span>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {colTasks.length}
                </span>
              </div>

              <div className="p-2.5 space-y-2.5 min-h-[200px]">
                {colTasks.map((task) => {
                  const assignee = users.find((u) => u.uid === task.assigneeId);
                  const project = task.projectId
                    ? projects.find((p) => p.id === task.projectId)
                    : null;
                  const overdue = isTaskOverdue(task);

                  return (
                    <div
                      key={task.id}
                      draggable={!task.isLocked}
                      onDragStart={(e) => {
                        setDraggingId(task.id);
                        e.dataTransfer.setData('text/plain', task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
                      }}
                      onClick={() => onSelectTask(task)}
                      className={`bg-white border border-slate-200 rounded-lg p-3 space-y-2.5 cursor-pointer hover:border-blue-300 transition-colors ${
                        draggingId === task.id ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-mono font-medium text-blue-700">
                          {task.code}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {task.isLocked && <Lock className="w-3 h-3 text-emerald-700" />}
                          {overdue && <span className="text-red-600 font-semibold">Quá hạn</span>}
                        </div>
                      </div>

                      <div className="text-sm font-medium text-slate-900 leading-snug line-clamp-2">
                        {task.title}
                      </div>

                      <div className="text-xs text-slate-500 truncate">
                        {project ? project.name : 'Việc thường xuyên'}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <PriorityLabel priority={task.priority} />
                        <span className="text-slate-600 truncate max-w-[130px]">
                          {assignee?.fullName || '—'}
                        </span>
                      </div>

                      {task.dueDate && (
                        <div
                          className={`text-[11px] tabular-nums ${
                            overdue ? 'text-red-600 font-medium' : 'text-slate-400'
                          }`}
                        >
                          Hạn: {formatDisplayDate(task.dueDate)}
                        </div>
                      )}

                      {/* Mobile / Touch Quick Move Selector */}
                      {!task.isLocked && (
                        <div
                          className="pt-1 md:hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <select
                            aria-label={`Chuyển trạng thái ${task.code}`}
                            value={task.status}
                            onChange={(e) => attemptMove(task, e.target.value as TaskStatus)}
                            className="w-full px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded"
                          >
                            {KANBAN_COLUMNS.map((st) => (
                              <option key={st} value={st}>
                                Chuyển: {TASK_STATUS_LABELS[st]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal prompt for note when dropping to CHO_XAC_NHAN or CHUA_HOAN_THANH */}
      {pendingTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              {pendingTransition.targetStatus === 'CHO_XAC_NHAN'
                ? `Nộp kết quả công việc ${pendingTransition.task.code}`
                : `Yêu cầu làm lại ${pendingTransition.task.code}`}
            </h3>
            <form onSubmit={submitTransitionPrompt} className="space-y-3">
              <textarea
                rows={3}
                required={pendingTransition.targetStatus === 'CHUA_HOAN_THANH'}
                value={transitionNote}
                onChange={(e) => setTransitionNote(e.target.value)}
                placeholder={
                  pendingTransition.targetStatus === 'CHO_XAC_NHAN'
                    ? 'Nhập tóm tắt kết quả thực hiện...'
                    : 'Bắt buộc nhập lý do chưa hoàn thành...'
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingTransition(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
                >
                  Xác nhận
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
