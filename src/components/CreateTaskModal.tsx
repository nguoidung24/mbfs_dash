import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PRIORITY_LABELS,
  Project,
  TaskItem,
  TaskPriority,
  UserProfile,
  WorkGroup,
} from '../types/domain';
import { canAssignToOthers, getAssignableUsers } from '../lib/rbac';
import { createOrUpdateTask } from '../lib/firestoreService';
import { getVietnamNowParts } from '../lib/time';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  users: UserProfile[];
  groups: WorkGroup[];
  projects: Project[];
  defaultProjectId?: string;
  editingTask?: TaskItem | null;
  existingTaskCount: number;
  availableLabels: string[];
  onSaved: (msg: string) => void;
}

export function CreateTaskModal({
  isOpen,
  onClose,
  currentUser,
  users,
  groups,
  projects,
  defaultProjectId = '',
  editingTask = null,
  existingTaskCount,
  availableLabels,
  onSaved,
}: CreateTaskModalProps) {
  const { dateStr: today } = getVietnamNowParts();
  const canAssign = canAssignToOthers(currentUser, projects);

  const [mode, setMode] = useState<'ASSIGN' | 'SELF'>(
    editingTask
      ? editingTask.assigneeId === currentUser.uid && editingTask.creatorId === currentUser.uid
        ? 'SELF'
        : 'ASSIGN'
      : canAssign
      ? 'ASSIGN'
      : 'SELF'
  );

  const [title, setTitle] = useState(editingTask?.title || '');
  const [description, setDescription] = useState(editingTask?.description || '');
  const [projectId, setProjectId] = useState(editingTask?.projectId ?? defaultProjectId);
  const [groupId, setGroupId] = useState(
    editingTask?.groupId || currentUser.groupId || groups[0]?.id || ''
  );
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    editingTask ? [editingTask.assigneeId] : mode === 'SELF' ? [currentUser.uid] : []
  );
  const [reviewerId, setReviewerId] = useState(
    editingTask?.reviewerId || (mode === 'SELF' ? currentUser.managerId || currentUser.uid : currentUser.uid)
  );
  const [priority, setPriority] = useState<TaskPriority>(editingTask?.priority || 'TRUNG_BINH');
  const [startDate, setStartDate] = useState(editingTask?.startDate || today);
  const [dueDate, setDueDate] = useState(editingTask?.dueDate || today);
  const [estimatedHours, setEstimatedHours] = useState(
    String(editingTask?.estimatedHours ?? 4)
  );
  const [selectedLabels, setSelectedLabels] = useState<string[]>(editingTask?.labels || []);
  const [attachmentInput, setAttachmentInput] = useState('');
  const [attachments, setAttachments] = useState<string[]>(editingTask?.attachments || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedProject = useMemo(
    () => (projectId ? projects.find((p) => p.id === projectId) || null : null),
    [projectId, projects]
  );

  const assignableUsers = useMemo(
    () => getAssignableUsers(currentUser, users, selectedProject),
    [currentUser, users, selectedProject]
  );

  const potentialReviewers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.isActive &&
          (u.uid === currentUser.uid ||
            u.roles.includes('ADMIN') ||
            u.roles.includes('TRUONG_PHONG') ||
            u.roles.includes('PHO_PHONG') ||
            u.roles.includes('TRUONG_NHOM') ||
            u.roles.includes('QUAN_LY_DU_AN'))
      ),
    [users, currentUser.uid]
  );

  if (!isOpen) return null;

  function toggleAssignee(uid: string) {
    if (editingTask) {
      setAssigneeIds([uid]);
      return;
    }
    setAssigneeIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  }

  function toggleLabel(lbl: string) {
    setSelectedLabels((prev) =>
      prev.includes(lbl) ? prev.filter((l) => l !== lbl) : [...prev, lbl].slice(0, 10)
    );
  }

  function addAttachment() {
    const val = attachmentInput.trim();
    if (!val) return;
    if (attachments.length >= 10) return;
    setAttachments((prev) => [...prev, val]);
    setAttachmentInput('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Vui lòng nhập tiêu đề công việc.');
      return;
    }

    const finalAssignees = mode === 'SELF' ? [currentUser.uid] : assigneeIds;
    if (finalAssignees.length === 0) {
      setError('Vui lòng chọn ít nhất một người thực hiện.');
      return;
    }

    setSaving(true);
    try {
      await createOrUpdateTask({
        existingTask: editingTask || undefined,
        input: {
          title,
          description,
          projectId,
          groupId,
          assigneeIds: finalAssignees,
          reviewerId:
            mode === 'SELF'
              ? currentUser.managerId || currentUser.uid
              : reviewerId || currentUser.uid,
          priority,
          startDate,
          dueDate,
          estimatedHours: Number(estimatedHours) || 0,
          labels: selectedLabels,
          attachments,
        },
        actor: currentUser,
        projects,
        allUsers: users,
        existingTaskCount,
      });
      onSaved(
        editingTask
          ? 'Đã cập nhật thông tin công việc.'
          : finalAssignees.length > 1
          ? `Đã giao việc và tự tách thành ${finalAssignees.length} việc con độc lập.`
          : 'Đã tạo công việc mới.'
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu công việc.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {editingTask ? `Chỉnh sửa công việc ${editingTask.code}` : 'Tạo công việc mới'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {editingTask
                ? 'Cập nhật nội dung, thời hạn và phân công thực hiện'
                : 'Giao việc cho cấp dưới hoặc tự tạo công việc cho bản thân'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 space-y-5">
          {!editingTask && (
            <div className="inline-flex p-1 bg-slate-100 rounded-lg gap-1">
              {canAssign && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('ASSIGN');
                    setReviewerId(currentUser.uid);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    mode === 'ASSIGN'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Giao việc cho cấp dưới
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMode('SELF');
                  setAssigneeIds([currentUser.uid]);
                  setReviewerId(currentUser.managerId || currentUser.uid);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'SELF'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tự tạo việc của tôi
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Tiêu đề công việc <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ví dụ: Tổng hợp báo cáo công tác hành chính tháng 11"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Thuộc dự án
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="">Việc thường xuyên / ngoài dự án</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Nhóm phụ trách
              </label>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="">Chưa phân nhóm</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {mode === 'ASSIGN' ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Người thực hiện <span className="text-red-600">*</span>
                </label>
                {!editingTask && assigneeIds.length > 1 && (
                  <span className="text-xs text-blue-700 font-medium">
                    Hệ thống sẽ tự tách thành {assigneeIds.length} việc con độc lập
                  </span>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {assignableUsers.map((u) => {
                  const checked = assigneeIds.includes(u.uid);
                  return (
                    <label
                      key={u.uid}
                      className="flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type={editingTask ? 'radio' : 'checkbox'}
                          checked={checked}
                          onChange={() => toggleAssignee(u.uid)}
                          className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                        />
                        <span className="text-slate-900 font-medium">{u.fullName}</span>
                        <span className="text-xs text-slate-500">
                          {u.employeeCode} · {u.title || 'Chuyên viên'}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              Người thực hiện: <strong className="text-slate-900">{currentUser.fullName}</strong>
              <span className="mx-2 text-slate-300">·</span>
              Người xác nhận mặc định:{' '}
              <strong className="text-slate-900">
                {users.find((u) => u.uid === (currentUser.managerId || currentUser.uid))?.fullName ||
                  currentUser.fullName}
              </strong>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Người xác nhận
              </label>
              <select
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
                disabled={mode === 'SELF'}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-100 focus:outline-none focus:border-blue-700"
              >
                {potentialReviewers.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Mức ưu tiên
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              >
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((key) => (
                  <option key={key} value={key}>
                    {PRIORITY_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Ước lượng (giờ)
              </label>
              <input
                type="number"
                min="0"
                max="1000"
                step="0.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Ngày bắt đầu
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Hạn hoàn thành
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Mô tả chi tiết yêu cầu
            </label>
            <textarea
              rows={3}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nội dung hướng dẫn, tiêu chuẩn đầu ra, tài liệu liên quan..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Nhãn nghiệp vụ
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableLabels.map((lbl) => {
                const active = selectedLabels.includes(lbl);
                return (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => toggleLabel(lbl)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                      active
                        ? 'bg-blue-50 border-blue-700 text-blue-800 font-medium'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Tài liệu / Đường dẫn đính kèm (tối đa 10)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={attachmentInput}
                onChange={(e) => setAttachmentInput(e.target.value)}
                placeholder="Tên văn bản hoặc liên kết tài liệu nội bộ..."
                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
              <button
                type="button"
                onClick={addAttachment}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
              >
                Thêm tệp
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((att, idx) => (
                  <div
                    key={`${att}-${idx}`}
                    className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 px-2.5 py-1 rounded border border-slate-200"
                  >
                    <span className="truncate">{att}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((p) => p.filter((_, i) => i !== idx))}
                      className="text-red-600 hover:underline ml-2 shrink-0"
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : editingTask ? 'Lưu thay đổi' : 'Xác nhận tạo việc'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
