import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  CheckSquare,
  Edit3,
  History,
  Lock,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import {
  Project,
  REVIEW_RESULT_LABELS,
  SUBMISSION_STATUS_LABELS,
  TaskAuditLog,
  TaskComment,
  TaskItem,
  TaskSubtask,
  UserProfile,
  WorkGroup,
} from '../types/domain';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  addSubtask,
  addTaskComment,
  reviewTaskDecision,
  toggleSubtask,
  updateTaskProgressOrSubmit,
} from '../lib/firestoreService';
import { canCancelTask, canEditTaskMetadata, canReviewTask, isLeadershipUser } from '../lib/rbac';
import { formatDisplayDate, formatTimestamp, isTaskOverdue } from '../lib/time';
import { PriorityLabel, TaskStatusLabel } from './StatusText';

interface TaskDetailDrawerProps {
  task: TaskItem | null;
  onClose: () => void;
  currentUser: UserProfile;
  users: UserProfile[];
  groups: WorkGroup[];
  projects: Project[];
  allTasks: TaskItem[];
  onOpenEdit: (task: TaskItem) => void;
  onSelectTask: (task: TaskItem) => void;
  onNotify: (msg: string) => void;
}

export function TaskDetailDrawer({
  task,
  onClose,
  currentUser,
  users,
  groups,
  projects,
  allTasks,
  onOpenEdit,
  onSelectTask,
  onNotify,
}: TaskDetailDrawerProps) {
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [auditLogs, setAuditLogs] = useState<TaskAuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'DETAILS' | 'HISTORY'>('DETAILS');

  const [newSubtask, setNewSubtask] = useState('');
  const [commentText, setCommentText] = useState('');

  const [submitNote, setSubmitNote] = useState('');
  const [showSubmitBox, setShowSubmitBox] = useState(false);

  const [reviewAction, setReviewAction] = useState<'REJECT' | 'REOPEN' | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!task) return;
    setActionError('');
    setShowSubmitBox(false);
    setReviewAction(null);
    setReviewNote('');
    setSubmitNote('');

    const subQ = query(
      collection(db, 'tasks', task.id, 'subtasks'),
      orderBy('createdAt', 'asc')
    );
    const unsubSub = onSnapshot(
      subQ,
      (snap) => {
        setSubtasks(snap.docs.map((d) => d.data() as TaskSubtask));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `tasks/${task.id}/subtasks`)
    );

    const cmtQ = query(
      collection(db, 'tasks', task.id, 'comments'),
      orderBy('createdAt', 'asc')
    );
    const unsubCmt = onSnapshot(
      cmtQ,
      (snap) => {
        setComments(snap.docs.map((d) => d.data() as TaskComment));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `tasks/${task.id}/comments`)
    );

    const audQ = query(
      collection(db, 'tasks', task.id, 'auditLogs'),
      orderBy('createdAt', 'desc')
    );
    const unsubAud = onSnapshot(
      audQ,
      (snap) => {
        setAuditLogs(snap.docs.map((d) => d.data() as TaskAuditLog));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `tasks/${task.id}/auditLogs`)
    );

    return () => {
      unsubSub();
      unsubCmt();
      unsubAud();
    };
  }, [task?.id]);

  if (!task) return null;

  const creator = users.find((u) => u.uid === task.creatorId);
  const assignee = users.find((u) => u.uid === task.assigneeId);
  const reviewer = users.find((u) => u.uid === task.reviewerId);
  const project = task.projectId ? projects.find((p) => p.id === task.projectId) : null;
  const group = groups.find((g) => g.id === task.groupId);
  const childTasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const parentTask = task.parentTaskId
    ? allTasks.find((t) => t.id === task.parentTaskId) || null
    : null;

  const overdue = isTaskOverdue(task);
  const isAssignee = task.assigneeId === currentUser.uid;
  const canReview = canReviewTask(currentUser, task, projects, groups);
  const canEdit = canEditTaskMetadata(currentUser, task, projects, groups);
  const canCancel = canCancelTask(currentUser, task, projects, groups);
  const canReopen = task.isLocked && (isLeadershipUser(currentUser) || task.reviewerId === currentUser.uid);

  async function handleStartWork() {
    if (!task) return;
    setBusy(true);
    setActionError('');
    try {
      await updateTaskProgressOrSubmit({
        task,
        actor: currentUser,
        nextStatus: 'DANG_THUC_HIEN',
      });
      onNotify('Đã chuyển sang Đang thực hiện.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitResult(e: React.FormEvent) {
    e.preventDefault();
    if (!task) return;
    setBusy(true);
    setActionError('');
    try {
      await updateTaskProgressOrSubmit({
        task,
        actor: currentUser,
        nextStatus: 'CHO_XAC_NHAN',
        submissionNote: submitNote.trim() || 'Đã hoàn thành và nộp kết quả',
      });
      setShowSubmitBox(false);
      setSubmitNote('');
      onNotify('Đã nộp kết quả chờ cấp trên xác nhận.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể nộp kết quả.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!task) return;
    setBusy(true);
    setActionError('');
    try {
      await reviewTaskDecision({
        task,
        actor: currentUser,
        decision: 'APPROVE',
      });
      onNotify('Đã xác nhận hoàn thành và khóa công việc.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể xác nhận.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmReviewNote(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !reviewAction) return;
    if (reviewNote.trim().length < 3) {
      setActionError('Bắt buộc nhập lý do tối thiểu 3 ký tự.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await reviewTaskDecision({
        task,
        actor: currentUser,
        decision: reviewAction,
        note: reviewNote.trim(),
      });
      setReviewAction(null);
      setReviewNote('');
      onNotify(
        reviewAction === 'REJECT'
          ? 'Đã trả lại công việc (Chưa hoàn thành).'
          : 'Đã mở lại công việc.'
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Thao tác thất bại.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelTask() {
    if (!task) return;
    setBusy(true);
    try {
      await reviewTaskDecision({
        task,
        actor: currentUser,
        decision: 'CANCEL',
        note: 'Hủy công việc theo yêu cầu quản lý',
      });
      onNotify('Đã hủy công việc.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể hủy công việc.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !newSubtask.trim() || task.isLocked) return;
    await addSubtask(task, newSubtask, currentUser);
    setNewSubtask('');
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !commentText.trim()) return;
    const mentions = users
      .filter((u) => commentText.includes(`@${u.fullName}`))
      .map((u) => u.uid);
    await addTaskComment(task, commentText, mentions, currentUser);
    setCommentText('');
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
      <div className="w-full max-w-2xl bg-white border-l border-slate-200 h-full flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 gap-3 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs font-semibold text-blue-700 shrink-0">
              {task.code}
            </span>
            <span className="text-slate-300" aria-hidden="true">/</span>
            <span className="text-xs text-slate-500 truncate">
              {project ? `${project.code} · ${project.name}` : 'Việc thường xuyên ngoài dự án'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canEdit && !task.isLocked && (
              <button
                type="button"
                onClick={() => onOpenEdit(task)}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Sửa
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              aria-label="Đóng chi tiết"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 pb-safe space-y-6">
          {/* Title + Status */}
          <div className="space-y-3">
            {parentTask && (
              <button
                type="button"
                onClick={() => onSelectTask(parentTask)}
                className="text-xs text-blue-700 hover:underline font-medium"
              >
                ← Việc cha: {parentTask.code} — {parentTask.title}
              </button>
            )}
            <h2 className="text-lg font-semibold text-slate-900 leading-snug">
              {task.title}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <TaskStatusLabel status={task.status} isOverdue={overdue} />
              <span className="text-slate-300" aria-hidden="true">·</span>
              <PriorityLabel priority={task.priority} />
              {task.isLocked && (
                <>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                    <Lock className="w-3.5 h-3.5" />
                    Đã khóa chỉnh sửa
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Two-Layer Status & Actions */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-slate-500">Bước 1 · Trạng thái nộp kết quả</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {SUBMISSION_STATUS_LABELS[task.submissionStatus]}
                </div>
                {task.submissionNote && (
                  <p className="text-slate-600 mt-1 leading-relaxed">{task.submissionNote}</p>
                )}
              </div>
              <div>
                <div className="text-slate-500">Bước 2 · Kết quả xác nhận</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {REVIEW_RESULT_LABELS[task.reviewResult]}
                </div>
                {task.reviewNote && (
                  <p className="text-slate-600 mt-1 leading-relaxed">{task.reviewNote}</p>
                )}
              </div>
            </div>

            {actionError && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {actionError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
              {!task.isLocked && isAssignee && (task.status === 'MOI' || task.status === 'CHUA_HOAN_THANH' || task.status === 'TAM_HOAN') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleStartWork}
                  className="min-h-[38px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 whitespace-nowrap"
                >
                  Bắt đầu thực hiện
                </button>
              )}

              {!task.isLocked && isAssignee && task.status !== 'CHO_XAC_NHAN' && task.status !== 'HUY' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowSubmitBox((v) => !v)}
                  className="inline-flex items-center gap-1.5 min-h-[38px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  Nộp kết quả
                </button>
              )}

              {!task.isLocked && canReview && task.status !== 'HUY' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleApprove}
                    className="inline-flex items-center gap-1.5 min-h-[38px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 whitespace-nowrap"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Xác nhận hoàn thành
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setReviewAction('REJECT')}
                    className="inline-flex items-center gap-1.5 min-h-[38px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 whitespace-nowrap"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Trả lại (Chưa hoàn thành)
                  </button>
                </>
              )}

              {canReopen && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReviewAction('REOPEN')}
                  className="inline-flex items-center gap-1.5 min-h-[38px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded-lg hover:bg-amber-50 whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Mở lại công việc
                </button>
              )}

              {!task.isLocked && canCancel && task.status !== 'HUY' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCancelTask}
                  className="min-h-[38px] sm:min-h-0 px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 whitespace-nowrap ml-auto"
                >
                  Hủy công việc
                </button>
              )}
            </div>

            {showSubmitBox && (
              <form onSubmit={handleSubmitResult} className="pt-3 border-t border-slate-200 space-y-2.5">
                <label className="block text-xs font-medium text-slate-700">
                  Ghi chú kết quả nộp cho người xác nhận
                </label>
                <textarea
                  rows={2}
                  value={submitNote}
                  onChange={(e) => setSubmitNote(e.target.value)}
                  placeholder="Tóm tắt kết quả công việc, số hiệu văn bản hoặc ghi chú bàn giao..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSubmitBox(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
                  >
                    Xác nhận nộp kết quả
                  </button>
                </div>
              </form>
            )}

            {reviewAction && (
              <form onSubmit={handleConfirmReviewNote} className="pt-3 border-t border-slate-200 space-y-2.5">
                <label className="block text-xs font-medium text-slate-700">
                  {reviewAction === 'REJECT'
                    ? 'Lý do chưa hoàn thành / yêu cầu chỉnh sửa (bắt buộc):'
                    : 'Lý do mở lại công việc đã khóa (bắt buộc):'}
                </label>
                <textarea
                  rows={2}
                  required
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Nhập nhận xét cụ thể..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReviewAction(null);
                      setReviewNote('');
                    }}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-red-700 rounded-lg hover:bg-red-800"
                  >
                    {reviewAction === 'REJECT' ? 'Trả lại để làm tiếp' : 'Xác nhận mở lại'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Sub-tabs */}
          <div className="flex items-center gap-4 border-b border-slate-200 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('DETAILS')}
              className={`pb-2.5 border-b-2 transition-colors ${
                activeTab === 'DETAILS'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              Thông tin & Trao đổi
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('HISTORY')}
              className={`inline-flex items-center gap-1.5 pb-2.5 border-b-2 transition-colors ${
                activeTab === 'HISTORY'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Lịch sử thay đổi ({auditLogs.length})
            </button>
          </div>

          {activeTab === 'DETAILS' ? (
            <div className="space-y-6">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-slate-500">Người thực hiện</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {assignee?.fullName || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Người giao việc</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {creator?.fullName || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Người xác nhận</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {reviewer?.fullName || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Nhóm phụ trách</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {group?.name || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Ngày bắt đầu · Hạn hoàn thành</div>
                  <div className="font-medium text-slate-900 mt-0.5 tabular-nums">
                    {formatDisplayDate(task.startDate)} → {formatDisplayDate(task.dueDate)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Ước lượng</div>
                  <div className="font-medium text-slate-900 mt-0.5 tabular-nums">
                    {task.estimatedHours ?? 0} giờ
                  </div>
                </div>
              </div>

              {task.labels && task.labels.length > 0 && (
                <div className="text-xs text-slate-500">
                  Nhãn: <span className="text-slate-800 font-medium">{task.labels.join(' · ')}</span>
                </div>
              )}

              {/* Description */}
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-700">Mô tả công việc</h3>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {task.description || 'Chưa có mô tả chi tiết.'}
                </p>
              </div>

              {/* Linked Split Child Tasks (when assigned to multiple people) */}
              {childTasks.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-700">
                    Các việc con tách theo người thực hiện ({childTasks.length})
                  </h3>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {childTasks.map((ct) => {
                      const u = users.find((x) => x.uid === ct.assigneeId);
                      return (
                        <button
                          key={ct.id}
                          type="button"
                          onClick={() => onSelectTask(ct)}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 text-left"
                        >
                          <div className="min-w-0">
                            <span className="font-mono text-blue-700 mr-2">{ct.code}</span>
                            <span className="font-medium text-slate-900">{u?.fullName}</span>
                          </div>
                          <TaskStatusLabel status={ct.status} isOverdue={isTaskOverdue(ct)} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Subtasks Checklist */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-700">
                  Đầu việc con ({subtasks.filter((s) => s.isDone).length}/{subtasks.length})
                </h3>
                <div className="space-y-1.5">
                  {subtasks.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      disabled={task.isLocked}
                      onClick={() => toggleSubtask(task, sub.id, !sub.isDone)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 text-left text-sm hover:bg-slate-50 disabled:opacity-70"
                    >
                      {sub.isDone ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span className={sub.isDone ? 'line-through text-slate-400' : 'text-slate-800'}>
                        {sub.title}
                      </span>
                    </button>
                  ))}
                </div>
                {!task.isLocked && (
                  <form onSubmit={handleAddSubtask} className="flex gap-2">
                    <input
                      type="text"
                      value={newSubtask}
                      onChange={(e) => setNewSubtask(e.target.value)}
                      placeholder="Thêm đầu việc con..."
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Thêm
                    </button>
                  </form>
                )}
              </div>

              {/* Comments */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Trao đổi & Bình luận ({comments.length})
                </h3>
                <div className="space-y-2.5">
                  {comments.map((c) => (
                    <div key={c.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900">{c.authorName}</span>
                        <span className="text-slate-400 tabular-nums">
                          {formatTimestamp(c.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-line">{c.content}</p>
                    </div>
                  ))}
                </div>
                <form onSubmit={handleAddComment} className="space-y-2">
                  <textarea
                    rows={2}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Nhập bình luận hoặc dùng @Tên nhân sự để nhắc tên..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!commentText.trim()}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-40"
                    >
                      Gửi bình luận
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {auditLogs.length === 0 ? (
                <p className="text-xs text-slate-500">Chưa có lịch sử ghi nhận.</p>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg border border-slate-200 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {log.actorName} · {log.action}
                      </span>
                      <span className="text-slate-400 tabular-nums">
                        {formatTimestamp(log.createdAt)}
                      </span>
                    </div>
                    <p className="text-slate-600">{log.detail}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
