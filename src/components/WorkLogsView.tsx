import React, { useMemo, useState } from 'react';
import { deleteDoc, doc } from 'firebase/firestore';
import { Calendar, Clock, Lock, Plus, Trash2, Unlock, X } from 'lucide-react';
import {
  Project,
  SystemConfig,
  TaskItem,
  UserProfile,
  WorkGroup,
  WorkLog,
  WorkLogUnlock,
} from '../types/domain';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { saveWorkLog, unlockWorkLogDate } from '../lib/firestoreService';
import {
  canUnlockWorkLog,
  getScopedUsers,
  getUserScopeTier,
  isAdminUser,
} from '../lib/rbac';
import {
  evaluateWorkLogDateAccess,
  formatDisplayDate,
  getCurrentWeekDates,
  getMonthDates,
  getVietnamNowParts,
} from '../lib/time';

interface WorkLogsViewProps {
  currentUser: UserProfile;
  users: UserProfile[];
  tasks: TaskItem[];
  projects?: Project[];
  groups?: WorkGroup[];
  workLogs: WorkLog[];
  unlocks: WorkLogUnlock[];
  config: SystemConfig | null;
  onNotify: (msg: string) => void;
}

export function WorkLogsView({
  currentUser,
  users,
  tasks,
  projects = [],
  groups = [],
  workLogs,
  unlocks,
  config,
  onNotify,
}: WorkLogsViewProps) {
  const { dateStr: todayStr } = getVietnamNowParts();
  const [selectedUserId, setSelectedUserId] = useState(currentUser.uid);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [calendarMode, setCalendarMode] = useState<'WEEK' | 'MONTH'>('WEEK');

  const [taskId, setTaskId] = useState('');
  const [hours, setHours] = useState('2');
  const [progressPercent, setProgressPercent] = useState('50');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Unlock modal
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [unlockUserId, setUnlockUserId] = useState(currentUser.uid);
  const [unlockDate, setUnlockDate] = useState(todayStr);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockSaving, setUnlockSaving] = useState(false);

  const canUnlock = canUnlockWorkLog(currentUser);
  const isAdmin = isAdminUser(currentUser);
  const userTier = getUserScopeTier(currentUser);

  const viewableUsers = useMemo(
    () => getScopedUsers(currentUser, users, projects, groups),
    [currentUser, users, projects, groups]
  );

  const canSwitchUser = userTier !== 'STAFF' && viewableUsers.length > 1;

  const targetUser = useMemo(
    () => viewableUsers.find((u) => u.uid === selectedUserId) || currentUser,
    [viewableUsers, selectedUserId, currentUser]
  );

  const canEditTarget = targetUser.uid === currentUser.uid || isAdmin;

  const dateAccess = useMemo(
    () =>
      evaluateWorkLogDateAccess(
        targetUser.uid,
        selectedDate,
        config,
        unlocks,
        isAdmin
      ),
    [targetUser.uid, selectedDate, config, unlocks, isAdmin]
  );

  const dayLogs = useMemo(
    () =>
      workLogs.filter(
        (w) => w.userId === targetUser.uid && w.workDate === selectedDate
      ),
    [workLogs, targetUser.uid, selectedDate]
  );

  const dayTotalHours = useMemo(
    () => dayLogs.reduce((acc, w) => acc + (Number(w.hours) || 0), 0),
    [dayLogs]
  );

  const selectableTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status !== 'HUY' &&
          (t.assigneeId === targetUser.uid ||
            t.creatorId === targetUser.uid ||
            t.participantIds.includes(targetUser.uid))
      ),
    [tasks, targetUser.uid]
  );

  const calendarDates = useMemo(() => {
    if (calendarMode === 'WEEK') {
      return getCurrentWeekDates(selectedDate);
    }
    const [y, m] = selectedDate.split('-').map(Number);
    return getMonthDates(y, m - 1);
  }, [calendarMode, selectedDate]);

  async function handleSaveLog(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!canEditTarget) {
      setError('Bạn chỉ có thể ghi nhật ký làm việc cho chính mình.');
      return;
    }

    if (!dateAccess.canEdit) {
      setError(dateAccess.reason);
      return;
    }

    const chosenTask = selectableTasks.find((t) => t.id === taskId) || selectableTasks[0];
    if (!chosenTask) {
      setError('Vui lòng chọn công việc đã thực hiện.');
      return;
    }

    const numHours = Number(hours);
    if (!numHours || numHours <= 0 || numHours > 24) {
      setError('Số giờ làm việc phải lớn hơn 0 và không vượt quá 24 giờ.');
      return;
    }

    if (!note.trim()) {
      setError('Vui lòng nhập ghi chú kết quả làm được.');
      return;
    }

    setSaving(true);
    try {
      await saveWorkLog({
        userId: targetUser.uid,
        task: chosenTask,
        workDate: selectedDate,
        hours: numHours,
        progressPercent: Number(progressPercent) || 0,
        note,
        allUsers: users,
      });
      setNote('');
      onNotify(`Đã ghi nhận ${numHours} giờ cho ngày ${formatDisplayDate(selectedDate)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể ghi nhận nhật ký làm việc.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLog(log: WorkLog) {
    if (!dateAccess.canEdit) {
      setError(dateAccess.reason);
      return;
    }
    try {
      await deleteDoc(doc(db, 'workLogs', log.id));
      onNotify('Đã xóa mục nhật ký làm việc.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `workLogs/${log.id}`);
    }
  }

  async function handleUnlockSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (unlockReason.trim().length < 3) return;
    const u = users.find((x) => x.uid === unlockUserId);
    if (!u) return;
    setUnlockSaving(true);
    try {
      await unlockWorkLogDate({
        targetUser: u,
        workDate: unlockDate,
        reason: unlockReason,
        actor: currentUser,
        allUsers: users,
      });
      setUnlockModalOpen(false);
      setUnlockReason('');
      onNotify(`Đã mở khóa ngày ${formatDisplayDate(unlockDate)} cho ${u.fullName}.`);
    } finally {
      setUnlockSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3 sm:gap-4">
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-3 w-full sm:w-auto">
          <div className="min-w-0">
            <label className="block text-[11px] text-slate-500 mb-1">Nhân sự</label>
            <select
              value={targetUser.uid}
              disabled={!canSwitchUser}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-50"
            >
              {viewableUsers.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.fullName} ({u.employeeCode})
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="block text-[11px] text-slate-500 mb-1">
              Ngày làm việc (Giờ VN UTC+7)
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
            />
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <div className="text-left sm:text-right">
            <div className="text-xs text-slate-500">Tổng giờ ngày {formatDisplayDate(selectedDate)}</div>
            <div className="text-lg font-semibold text-slate-900 tabular-nums">
              {dayTotalHours.toFixed(1)} / 8.0 giờ
            </div>
          </div>

          {canUnlock && (
            <button
              type="button"
              onClick={() => {
                setUnlockUserId(targetUser.uid);
                setUnlockDate(selectedDate);
                setUnlockModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 whitespace-nowrap"
            >
              <Unlock className="w-3.5 h-3.5" />
              Mở khóa ngày
            </button>
          )}
        </div>
      </div>

      {/* Date Lock Banner */}
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${
          dateAccess.canEdit
            ? dateAccess.state === 'UNLOCKED'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-red-50 border-red-200 text-red-900'
        }`}
      >
        <div className="flex items-center gap-2">
          {dateAccess.canEdit ? (
            <Clock className="w-4 h-4 shrink-0" />
          ) : (
            <Lock className="w-4 h-4 shrink-0" />
          )}
          <span className="font-medium">{dateAccess.reason}</span>
        </div>
        <span className="font-mono text-[11px] shrink-0">
          Khóa tự động: {String(config?.lockHour ?? 23).padStart(2, '0')}:
          {String(config?.lockMinute ?? 59).padStart(2, '0')}
        </span>
      </div>

      {/* Calendar Weekly / Monthly Status Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Calendar className="w-4 h-4 text-blue-700" />
            Theo dõi trạng thái nhật ký theo {calendarMode === 'WEEK' ? 'tuần' : 'tháng'}
          </div>
          <div className="inline-flex p-1 bg-slate-100 rounded-lg gap-1">
            <button
              type="button"
              onClick={() => setCalendarMode('WEEK')}
              className={`px-2.5 py-1 text-xs font-medium rounded ${
                calendarMode === 'WEEK' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Theo tuần
            </button>
            <button
              type="button"
              onClick={() => setCalendarMode('MONTH')}
              className={`px-2.5 py-1 text-xs font-medium rounded ${
                calendarMode === 'MONTH' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Theo tháng
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {calendarDates.map((d) => {
            const hrs = workLogs
              .filter((w) => w.userId === targetUser.uid && w.workDate === d)
              .reduce((acc, w) => acc + (Number(w.hours) || 0), 0);
            const access = evaluateWorkLogDateAccess(targetUser.uid, d, config, unlocks, isAdmin);
            const isSelected = d === selectedDate;
            const statusText =
              d > todayStr
                ? 'Chưa tới'
                : hrs >= 8
                ? 'Đủ giờ'
                : hrs > 0
                ? 'Thiếu giờ'
                : access.canEdit
                ? 'Chưa ghi'
                : 'Đã khóa';

            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={`p-1.5 sm:p-2 min-h-[56px] rounded-lg border text-left transition-colors ${
                  isSelected
                    ? 'border-blue-700 bg-blue-50/70'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-slate-500">
                  <span>{d.slice(8)}/{d.slice(5, 7)}</span>
                  {access.state === 'UNLOCKED' && <Unlock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-600" />}
                  {!access.canEdit && d < todayStr && <Lock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-400" />}
                </div>
                <div className="text-[11px] sm:text-xs font-semibold text-slate-900 mt-1 tabular-nums">
                  {hrs.toFixed(1)}h
                </div>
                <div
                  className={`hidden sm:block text-[11px] mt-0.5 truncate ${
                    hrs >= 8
                      ? 'text-emerald-700 font-medium'
                      : hrs > 0
                      ? 'text-amber-700'
                      : !access.canEdit && d < todayStr
                      ? 'text-red-600'
                      : 'text-slate-400'
                  }`}
                >
                  {statusText}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split: Log Form + Day Entries */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Form */}
        <form
          onSubmit={handleSaveLog}
          className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            Ghi nhận công việc ngày {formatDisplayDate(selectedDate)}
          </h3>

          {!canEditTarget && (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              Đang xem nhật ký của <strong>{targetUser.fullName}</strong> (chế độ chỉ đọc). Bạn chỉ có thể ghi nhật ký cho tài khoản của mình.
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Công việc thực hiện
            </label>
            <select
              disabled={!dateAccess.canEdit || !canEditTarget}
              value={taskId || selectableTasks[0]?.id || ''}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
            >
              {selectableTasks.length === 0 ? (
                <option value="">Chưa có công việc khả dụng</option>
              ) : (
                selectableTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.title}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Số giờ làm
              </label>
              <input
                type="number"
                min="0.5"
                max="24"
                step="0.5"
                disabled={!dateAccess.canEdit || !canEditTarget}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums disabled:bg-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Tiến độ (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="5"
                disabled={!dateAccess.canEdit || !canEditTarget}
                value={progressPercent}
                onChange={(e) => setProgressPercent(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums disabled:bg-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Kết quả làm được
            </label>
            <textarea
              rows={3}
              disabled={!dateAccess.canEdit || !canEditTarget}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Mô tả cụ thể đầu việc đã xử lý trong ngày..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
            />
          </div>

          <button
            type="submit"
            disabled={!dateAccess.canEdit || saving || !canEditTarget}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Đang lưu...' : 'Lưu nhật ký làm việc'}
          </button>
        </form>

        {/* Entries List */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Nhật ký đã ghi ({dayLogs.length})
            </h3>
            <span className="text-xs text-slate-500 tabular-nums">
              Tổng: {dayTotalHours.toFixed(1)} giờ
            </span>
          </div>

          {dayLogs.length === 0 ? (
            <div className="py-10 px-6 text-center text-sm text-slate-500">
              Chưa có mục nhật ký nào được ghi trong ngày {formatDisplayDate(selectedDate)}.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dayLogs.map((log) => {
                const task = tasks.find((t) => t.id === log.taskId);
                return (
                  <div key={log.id} className="p-4 flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-blue-700">
                          {task?.code || 'TASK'}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-900 tabular-nums">
                          {log.hours} giờ
                        </span>
                        {typeof log.progressPercent === 'number' && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="text-slate-500 tabular-nums">
                              Tiến độ {log.progressPercent}%
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-sm font-medium text-slate-900">
                        {task?.title || 'Công việc không xác định'}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{log.note}</p>
                    </div>

                    {dateAccess.canEdit && (log.userId === currentUser.uid || isAdmin) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteLog(log)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0"
                        title="Xóa mục nhật ký"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Unlock Modal */}
      {unlockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Mở khóa nhật ký quá hạn
              </h3>
              <button
                type="button"
                onClick={() => setUnlockModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUnlockSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nhân sự được mở khóa
                </label>
                <select
                  value={unlockUserId}
                  onChange={(e) => setUnlockUserId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {users
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.fullName} ({u.employeeCode})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ngày cần mở khóa
                </label>
                <input
                  type="date"
                  value={unlockDate}
                  max={todayStr}
                  onChange={(e) => setUnlockDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Lý do mở khóa (bắt buộc)
                </label>
                <textarea
                  rows={2}
                  required
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder="Ví dụ: Đi công tác ngoài phòng không có mạng..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setUnlockModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={unlockSaving || unlockReason.trim().length < 3}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-amber-700 rounded-lg hover:bg-amber-800 disabled:opacity-50"
                >
                  {unlockSaving ? 'Đang xử lý...' : 'Xác nhận mở khóa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
