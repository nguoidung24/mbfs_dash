import React, { useMemo, useState } from 'react';
import { ArrowLeft, Edit3, FolderKanban, Plus, Users, X } from 'lucide-react';
import {
  PROJECT_STATUS_LABELS,
  Project,
  ProjectStatus,
  SystemAuditLog,
  TASK_STATUS_LABELS,
  TaskItem,
  TaskStatus,
  UserProfile,
  WorkGroup,
} from '../types/domain';
import { saveProject } from '../lib/firestoreService';
import { canCreateProject, canEditProject } from '../lib/rbac';
import { formatDisplayDate, formatTimestamp, getVietnamNowParts } from '../lib/time';
import { KanbanBoard } from './KanbanBoard';
import { ProjectStatusLabel } from './StatusText';
import { TaskListView } from './TaskListView';

interface ProjectsViewProps {
  currentUser: UserProfile;
  projects: Project[];
  tasks: TaskItem[];
  users: UserProfile[];
  groups: WorkGroup[];
  auditLogs: SystemAuditLog[];
  availableLabels: string[];
  onSelectTask: (task: TaskItem) => void;
  onCreateTaskInProject: (projectId: string) => void;
  onNotify: (msg: string) => void;
}

export function ProjectsView({
  currentUser,
  projects,
  tasks,
  users,
  groups,
  auditLogs,
  availableLabels,
  onSelectTask,
  onCreateTaskInProject,
  onNotify,
}: ProjectsViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<
    'OVERVIEW' | 'KANBAN' | 'LIST' | 'MEMBERS' | 'HISTORY'
  >('OVERVIEW');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  // Modal state
  const { dateStr: today } = getVietnamNowParts();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [expectedEndDate, setExpectedEndDate] = useState(today);
  const [status, setStatus] = useState<ProjectStatus>('CHUAN_BI');
  const [pmId, setPmId] = useState(currentUser.uid);
  const [memberIds, setMemberIds] = useState<string[]>([currentUser.uid]);
  const [labels, setLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openCreate() {
    setEditingProject(null);
    setCode(`DA-${String(projects.length + 1).padStart(3, '0')}`);
    setName('');
    setDescription('');
    setStartDate(today);
    setExpectedEndDate(today);
    setStatus('CHUAN_BI');
    setPmId(currentUser.uid);
    setMemberIds([currentUser.uid]);
    setLabels([]);
    setError('');
    setModalOpen(true);
  }

  function openEdit(prj: Project) {
    setEditingProject(prj);
    setCode(prj.code);
    setName(prj.name);
    setDescription(prj.description || '');
    setStartDate(prj.startDate || today);
    setExpectedEndDate(prj.expectedEndDate || today);
    setStatus(prj.status);
    setPmId(prj.pmId);
    setMemberIds(prj.memberIds);
    setLabels(prj.labels || []);
    setError('');
    setModalOpen(true);
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!code.trim() || !name.trim()) {
      setError('Vui lòng nhập mã dự án và tên dự án.');
      return;
    }
    setSaving(true);
    try {
      await saveProject({
        existing: editingProject || undefined,
        input: {
          code,
          name,
          description,
          startDate,
          expectedEndDate,
          status,
          pmId,
          memberIds,
          labels,
        },
        actor: currentUser,
        allUsers: users,
      });
      onNotify(editingProject ? 'Đã cập nhật dự án.' : 'Đã tạo dự án mới.');
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu dự án.');
    } finally {
      setSaving(false);
    }
  }

  function renderProjectFormModal() {
    if (!modalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
        <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">
              {editingProject ? `Chỉnh sửa dự án ${editingProject.code}` : 'Tạo dự án mới'}
            </h3>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSaveProject} className="overflow-y-auto px-6 py-5 space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mã dự án <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="DA-003"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên dự án <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tên dự án hành chính / nghiệp vụ"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mô tả</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Trạng thái
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {PROJECT_STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ngày bắt đầu
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ngày kết thúc dự kiến
                </label>
                <input
                  type="date"
                  value={expectedEndDate}
                  onChange={(e) => setExpectedEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Quản lý dự án (PM)
              </label>
              <select
                value={pmId}
                onChange={(e) => setPmId(e.target.value)}
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
                Thành viên tham gia ({memberIds.length})
              </label>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {users
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <label
                      key={u.uid}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={memberIds.includes(u.uid)}
                        onChange={() =>
                          setMemberIds((prev) =>
                            prev.includes(u.uid)
                              ? prev.filter((id) => id !== u.uid)
                              : [...prev, u.uid]
                          )
                        }
                      />
                      <span className="font-medium text-slate-900">{u.fullName}</span>
                      <span className="text-slate-500">{u.title || u.employeeCode}</span>
                    </label>
                  ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nhãn dự án</label>
              <div className="flex flex-wrap gap-1.5">
                {availableLabels.map((lbl) => {
                  const active = labels.includes(lbl);
                  return (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() =>
                        setLabels((prev) =>
                          prev.includes(lbl) ? prev.filter((l) => l !== lbl) : [...prev, lbl]
                        )
                      }
                      className={`px-2.5 py-1 text-xs rounded-md border ${
                        active
                          ? 'bg-blue-50 border-blue-700 text-blue-800 font-medium'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : 'Lưu dự án'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (selectedProject) {
    const projectTasks = tasks.filter((t) => t.projectId === selectedProject.id);
    const completedCount = projectTasks.filter((t) => t.status === 'HOAN_THANH').length;
    const progressPct =
      projectTasks.length > 0 ? Math.round((completedCount / projectTasks.length) * 100) : 0;
    const pmUser = users.find((u) => u.uid === selectedProject.pmId);
    const members = users.filter((u) => selectedProject.memberIds.includes(u.uid));
    const projectAuditLogs = auditLogs.filter(
      (a) => a.targetId === selectedProject.id || projectTasks.some((t) => t.id === a.targetId)
    );

    const statusCounts = (Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((st) => ({
      status: st,
      label: TASK_STATUS_LABELS[st],
      count: projectTasks.filter((t) => t.status === st).length,
    }));

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Danh sách dự án
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-mono font-semibold text-blue-700">
                  {selectedProject.code}
                </span>
                <span aria-hidden="true">·</span>
                <ProjectStatusLabel status={selectedProject.status} />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 truncate">
                {selectedProject.name}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canEditProject(currentUser, selectedProject) && (
              <button
                type="button"
                onClick={() => openEdit(selectedProject)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Chỉnh sửa dự án
              </button>
            )}
            <button
              type="button"
              onClick={() => onCreateTaskInProject(selectedProject.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Thêm công việc
            </button>
          </div>
        </div>

        {/* Project Detail Tabs */}
        <div className="inline-flex flex-wrap p-1 bg-slate-100 rounded-lg gap-1">
          {[
            { id: 'OVERVIEW', label: 'Tổng quan' },
            { id: 'KANBAN', label: 'Bảng Kanban' },
            { id: 'LIST', label: 'Danh sách công việc' },
            { id: 'MEMBERS', label: `Thành viên (${members.length})` },
            { id: 'HISTORY', label: 'Lịch sử hoạt động' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setDetailTab(t.id as typeof detailTab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                detailTab === t.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {detailTab === 'OVERVIEW' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-500">Tiến độ hoàn thành dự án</div>
                  <div className="text-2xl font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {progressPct}% ({completedCount}/{projectTasks.length} công việc)
                  </div>
                </div>
                <div className="text-xs text-slate-600 space-y-1 text-right">
                  <div>
                    Quản lý dự án: <strong className="text-slate-900">{pmUser?.fullName || '—'}</strong>
                  </div>
                  <div className="tabular-nums">
                    Thời gian: {formatDisplayDate(selectedProject.startDate)} →{' '}
                    {formatDisplayDate(selectedProject.expectedEndDate)}
                  </div>
                </div>
              </div>

              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-700 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {selectedProject.description && (
                <p className="text-sm text-slate-700 leading-relaxed pt-2 border-t border-slate-100">
                  {selectedProject.description}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {statusCounts.map((sc) => (
                <div key={sc.status} className="bg-white border border-slate-200 rounded-xl p-3.5">
                  <div className="text-xs text-slate-500 truncate">{sc.label}</div>
                  <div className="text-xl font-semibold text-slate-900 mt-1 tabular-nums">
                    {sc.count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {detailTab === 'KANBAN' && (
          <KanbanBoard
            tasks={projectTasks}
            users={users}
            projects={projects}
            currentUser={currentUser}
            onSelectTask={onSelectTask}
            onNotify={onNotify}
          />
        )}

        {detailTab === 'LIST' && (
          <TaskListView
            tasks={projectTasks}
            users={users}
            groups={groups}
            projects={projects}
            onSelectTask={onSelectTask}
            onCreateTask={() => onCreateTaskInProject(selectedProject.id)}
          />
        )}

        {detailTab === 'MEMBERS' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Mã NV</th>
                  <th className="py-2.5 px-4">Họ và tên</th>
                  <th className="py-2.5 px-4">Chức danh</th>
                  <th className="py-2.5 px-4">Vai trò trong dự án</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {members.map((m) => (
                  <tr key={m.uid}>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                      {m.employeeCode}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{m.fullName}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">{m.title || '—'}</td>
                    <td className="py-2.5 px-4 text-xs font-medium text-blue-700">
                      {m.uid === selectedProject.pmId ? 'Quản lý dự án' : 'Thành viên'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detailTab === 'HISTORY' && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            {projectAuditLogs.length === 0 ? (
              <p className="text-xs text-slate-500">Chưa có nhật ký hoạt động cho dự án này.</p>
            ) : (
              projectAuditLogs.map((log) => (
                <div key={log.id} className="pb-3 border-b border-slate-100 last:border-0 text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-900">
                      {log.actorName} · {log.action}
                    </span>
                    <span className="text-slate-400 tabular-nums">
                      {formatTimestamp(log.createdAt)}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-0.5">{log.detail}</p>
                </div>
              ))
            )}
          </div>
        )}

        {renderProjectFormModal()}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Danh mục dự án phòng ban ({projects.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Theo dõi tiến độ tổng thể, phân công thành viên và bảng công việc từng dự án
          </p>
        </div>

        {canCreateProject(currentUser) && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Tạo dự án mới
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 px-6 text-center space-y-3">
          <FolderKanban className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm text-slate-600">Chưa có dự án nào được tạo.</p>
          {canCreateProject(currentUser) && (
            <button
              type="button"
              onClick={openCreate}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg"
            >
              Tạo dự án đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((prj) => {
            const prjTasks = tasks.filter((t) => t.projectId === prj.id);
            const done = prjTasks.filter((t) => t.status === 'HOAN_THANH').length;
            const pct = prjTasks.length > 0 ? Math.round((done / prjTasks.length) * 100) : 0;
            const pm = users.find((u) => u.uid === prj.pmId);

            return (
              <div
                key={prj.id}
                onClick={() => {
                  setSelectedProjectId(prj.id);
                  setDetailTab('OVERVIEW');
                }}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 cursor-pointer hover:border-blue-400 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-blue-700">{prj.code}</span>
                      <span aria-hidden="true">·</span>
                      <ProjectStatusLabel status={prj.status} />
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 mt-1 line-clamp-1">
                      {prj.name}
                    </h3>
                  </div>
                </div>

                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {prj.description || 'Chưa có mô tả dự án.'}
                </p>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Tiến độ công việc</span>
                    <span className="font-medium text-slate-900 tabular-nums">
                      {pct}% ({done}/{prjTasks.length})
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <span>Quản lý dự án: {pm?.fullName || '—'}</span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Users className="w-3.5 h-3.5" />
                    {prj.memberIds.length} thành viên · Hạn {formatDisplayDate(prj.expectedEndDate)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {renderProjectFormModal()}
    </div>
  );
}
