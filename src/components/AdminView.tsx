import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Download,
  Edit3,
  KeyRound,
  Lock,
  Plus,
  Settings,
  Shield,
  Trash2,
  Unlock,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  ROLE_LABELS,
  RoleCode,
  SystemAuditLog,
  SystemConfig,
  UserProfile,
  WorkGroup,
} from '../types/domain';
import {
  exportDatabaseToExcel,
  importDatabaseFromExcel,
  ImportSummary,
} from '../lib/excelBackup';
import {
  createGroupByAdmin,
  fetchUserEmailForAdmin,
  resetUserPasswordByAdmin,
  saveGroupByAdmin,
  saveSystemConfigByAdmin,
  saveUserByAdmin,
  toggleUserLockByAdmin,
  wipeAllDepartmentData,
} from '../lib/firestoreService';
import { canManageUsers } from '../lib/rbac';
import { formatTimestamp } from '../lib/time';

interface AdminViewProps {
  currentUser: UserProfile;
  users: UserProfile[];
  groups: WorkGroup[];
  config: SystemConfig | null;
  auditLogs: SystemAuditLog[];
  onNotify: (msg: string) => void;
  onCurrentUserUpdated?: (updated: UserProfile) => void;
}

export function AdminView({
  currentUser,
  users,
  groups,
  config,
  auditLogs,
  onNotify,
  onCurrentUserUpdated,
}: AdminViewProps) {
  const [tab, setTab] = useState<'USERS' | 'GROUPS' | 'CONFIG' | 'DATA' | 'AUDIT'>('USERS');
  const isAdmin = canManageUsers(currentUser);

  // User modal
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [uUsername, setUUsername] = useState('');
  const [uInitialPassword, setUInitialPassword] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uName, setUName] = useState('');
  const [uCode, setUCode] = useState('');
  const [uTitle, setUTitle] = useState('');
  const [uRoles, setURoles] = useState<RoleCode[]>(['CHUYEN_VIEN']);
  const [uGroupId, setUGroupId] = useState(groups[0]?.id || '');
  const [uManagerId, setUManagerId] = useState(currentUser.uid);
  const [uActive, setUActive] = useState(true);
  const [userModalError, setUserModalError] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // Reset password modal
  const [resetTargetUser, setResetTargetUser] = useState<UserProfile | null>(null);
  const [resetUsername, setResetUsername] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetMustChange, setResetMustChange] = useState(true);
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);

  // Group create / edit modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WorkGroup | null>(null);
  const [gCode, setGCode] = useState('');
  const [gName, setGName] = useState('');
  const [gDesc, setGDesc] = useState('');
  const [gLeader, setGLeader] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);

  // Config state
  const [lockHour, setLockHour] = useState(String(config?.lockHour ?? 23));
  const [lockMinute, setLockMinute] = useState(String(config?.lockMinute ?? 59));
  const [reminderHour, setReminderHour] = useState(String(config?.reminderHour ?? 17));
  const [reminderMinute, setReminderMinute] = useState(String(config?.reminderMinute ?? 30));
  const [labelsInput, setLabelsInput] = useState((config?.defaultLabels || []).join(', '));

  // Backup / Import / Wipe state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [dataError, setDataError] = useState('');
  const [wipeModalOpen, setWipeModalOpen] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wiping, setWiping] = useState(false);

  function openCreateUser() {
    setEditingUser(null);
    setUUsername('');
    setUInitialPassword('');
    setUEmail('');
    setUName('');
    setUCode(`NV-${String(users.length + 1).padStart(2, '0')}`);
    setUTitle('Chuyên viên');
    setURoles(['CHUYEN_VIEN']);
    setUGroupId(groups[0]?.id || '');
    setUManagerId('');
    setUActive(true);
    setUserModalError('');
    setUserModalOpen(true);
  }

  async function openEditUser(u: UserProfile) {
    setEditingUser(u);
    const email = await fetchUserEmailForAdmin(u.uid);
    setUUsername(u.username || '');
    setUInitialPassword('');
    setUEmail(email);
    setUName(u.fullName);
    setUCode(u.employeeCode);
    setUTitle(u.title || '');
    setURoles(u.roles);
    setUGroupId(u.groupId || '');
    setUManagerId(u.managerId || '');
    setUActive(u.isActive);
    setUserModalError('');
    setUserModalOpen(true);
  }

  function openResetModal(u: UserProfile) {
    setResetTargetUser(u);
    setResetUsername(u.username || u.employeeCode.toLowerCase().replace(/[^a-z0-9]/g, ''));
    setResetPassword('');
    setResetConfirm('');
    setResetMustChange(true);
    setResetError('');
  }

  function openCreateGroup() {
    setEditingGroup(null);
    setGCode(`NHOM-${groups.length + 1}`);
    setGName('');
    setGDesc('');
    setGLeader('');
    setGroupModalOpen(true);
  }

  function openEditGroup(g: WorkGroup) {
    setEditingGroup(g);
    setGCode(g.code);
    setGName(g.name);
    setGDesc(g.description || '');
    setGLeader(g.leaderId || '');
    setGroupModalOpen(true);
  }

  function toggleRole(r: RoleCode) {
    setURoles((prev) =>
      prev.includes(r) ? (prev.length > 1 ? prev.filter((x) => x !== r) : prev) : [...prev, r]
    );
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    setUserModalError('');
    if (!uName.trim() || !uCode.trim()) {
      setUserModalError('Vui lòng nhập đầy đủ mã nhân viên và họ tên.');
      return;
    }
    setSavingUser(true);
    try {
      await saveUserByAdmin({
        existing: editingUser || undefined,
        input: {
          username: uUsername,
          initialPassword: uInitialPassword,
          email: uEmail,
          fullName: uName,
          employeeCode: uCode,
          title: uTitle,
          roles: uRoles,
          groupId: uGroupId,
          managerId: uManagerId,
          isActive: uActive,
        },
        actor: currentUser,
        allUsers: users,
      });
      setUserModalOpen(false);
      onNotify(
        editingUser
          ? 'Đã cập nhật hồ sơ nhân sự.'
          : 'Đã tạo tài khoản mới (người dùng sẽ phải đổi mật khẩu ở lần đăng nhập đầu).'
      );
    } catch (err) {
      setUserModalError(err instanceof Error ? err.message : 'Không thể lưu tài khoản nhân sự.');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleResetPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTargetUser) return;
    setResetError('');
    if (resetPassword !== resetConfirm) {
      setResetError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setResetting(true);
    try {
      await resetUserPasswordByAdmin({
        targetUser: resetTargetUser,
        usernameInput: resetUsername,
        newPassword: resetPassword,
        requireChangeOnNextLogin: resetMustChange,
        actor: currentUser,
        allUsers: users,
      });
      setResetTargetUser(null);
      onNotify(`Đã đặt lại mật khẩu cho ${resetTargetUser.fullName}.`);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Không thể đặt lại mật khẩu.');
    } finally {
      setResetting(false);
    }
  }

  async function handleToggleLockUser(u: UserProfile) {
    if (!isAdmin || u.uid === currentUser.uid) return;
    await toggleUserLockByAdmin({
      targetUser: u,
      nextActive: !u.isActive,
      actor: currentUser,
      allUsers: users,
    });
    onNotify(u.isActive ? `Đã khóa tài khoản ${u.fullName}.` : `Đã mở khóa ${u.fullName}.`);
  }

  async function handleSaveGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!gName.trim()) return;
    setSavingGroup(true);
    try {
      if (editingGroup) {
        await saveGroupByAdmin({
          group: editingGroup,
          name: gName,
          description: gDesc,
          leaderId: gLeader,
          allUsers: users,
          actor: currentUser,
        });
        onNotify('Đã cập nhật thông tin nhóm việc.');
      } else {
        await createGroupByAdmin({
          code: gCode || `NHOM-${groups.length + 1}`,
          name: gName,
          description: gDesc,
          leaderId: gLeader,
          allUsers: users,
          actor: currentUser,
        });
        onNotify('Đã tạo nhóm việc mới.');
      }
      setGroupModalOpen(false);
      setEditingGroup(null);
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    const labels = labelsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await saveSystemConfigByAdmin({
      config: {
        lockHour: Math.min(23, Math.max(0, Number(lockHour) || 23)),
        lockMinute: Math.min(59, Math.max(0, Number(lockMinute) || 59)),
        reminderHour: Math.min(23, Math.max(0, Number(reminderHour) || 17)),
        reminderMinute: Math.min(59, Math.max(0, Number(reminderMinute) || 30)),
        timezone: 'Asia/Ho_Chi_Minh',
        defaultLabels: labels,
      },
      actor: currentUser,
      allUsers: users,
    });
    onNotify('Đã lưu cấu hình phòng ban.');
  }

  async function handleExportExcel() {
    setDataError('');
    setExporting(true);
    try {
      await exportDatabaseToExcel(currentUser);
      onNotify('Đã tải xuống toàn bộ cơ sở dữ liệu dạng Excel (.xlsx).');
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Không thể xuất file Excel.');
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setDataError('');
    setImportResult(null);
    setImporting(true);
    try {
      const result = await importDatabaseFromExcel(file, currentUser);
      setImportResult(result);
      onNotify('Đã import dữ liệu từ file Excel thành công.');
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Import file Excel thất bại.');
    } finally {
      setImporting(false);
    }
  }

  async function handleWipeAllData(e: React.FormEvent) {
    e.preventDefault();
    if (wipeConfirmText.trim().toUpperCase() !== 'XOA TOAN BO') return;
    setDataError('');
    setWiping(true);
    try {
      const res = await wipeAllDepartmentData(currentUser);
      if (onCurrentUserUpdated) {
        onCurrentUserUpdated(res.normalizedAdmin);
      }
      setWipeModalOpen(false);
      setWipeConfirmText('');
      setImportResult(null);
      onNotify(`Đã xóa ${res.deletedDocs} bản ghi dữ liệu, chỉ giữ lại tài khoản Admin.`);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Không thể xóa dữ liệu.');
    } finally {
      setWiping(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap p-1 bg-slate-100 rounded-lg gap-1">
          <button
            type="button"
            onClick={() => setTab('USERS')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              tab === 'USERS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Nhân sự & Tài khoản ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('GROUPS')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              tab === 'GROUPS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Nhóm việc ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('CONFIG')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              tab === 'CONFIG' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Cấu hình khóa ngày
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setTab('DATA')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                tab === 'DATA' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Sao lưu & Dữ liệu
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('AUDIT')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              tab === 'AUDIT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Nhật ký hệ thống ({auditLogs.length})
          </button>
        </div>

        {isAdmin && tab === 'USERS' && (
          <button
            type="button"
            onClick={openCreateUser}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Tạo tài khoản nhân sự
          </button>
        )}

        {isAdmin && tab === 'GROUPS' && (
          <button
            type="button"
            onClick={openCreateGroup}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Thêm nhóm việc
          </button>
        )}
      </div>

      {tab === 'USERS' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Mã NV</th>
                  <th className="py-2.5 px-4">Tài khoản</th>
                  <th className="py-2.5 px-4">Họ và tên</th>
                  <th className="py-2.5 px-4">Nhóm</th>
                  <th className="py-2.5 px-4">Vai trò RBAC</th>
                  <th className="py-2.5 px-4">Cấp trên trực tiếp</th>
                  <th className="py-2.5 px-4">Trạng thái</th>
                  {isAdmin && <th className="py-2.5 px-4 text-right">Thao tác</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {users.map((u) => {
                  const grp = groups.find((g) => g.id === u.groupId);
                  const mgr = users.find((m) => m.uid === u.managerId);
                  return (
                    <tr key={u.uid} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {u.employeeCode}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {u.username ? `@${u.username}` : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{u.fullName}</div>
                        <div className="text-xs text-slate-500">{u.title || '—'}</div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {grp?.name || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700">
                        {u.roles.map((r) => ROLE_LABELS[r]).join(' · ')}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {mgr?.fullName || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                        <span
                          className={
                            u.isActive ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'
                          }
                        >
                          {u.isActive ? 'Đang hoạt động' : 'Đã khóa'}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-3">
                          <button
                            type="button"
                            onClick={() => openEditUser(u)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => openResetModal(u)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Đặt lại MK
                          </button>
                          {u.uid !== currentUser.uid && (
                            <button
                              type="button"
                              onClick={() => handleToggleLockUser(u)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-red-700"
                            >
                              {u.isActive ? (
                                <>
                                  <Lock className="w-3.5 h-3.5" />
                                  Khóa
                                </>
                              ) : (
                                <>
                                  <Unlock className="w-3.5 h-3.5" />
                                  Mở
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'GROUPS' && (
        <div className="space-y-4">
          {groups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-sm text-slate-600">
                Chưa có nhóm việc nào trong phòng ban.
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={openCreateGroup}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tạo nhóm việc đầu tiên
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map((g) => {
                const leader = users.find((u) => u.uid === g.leaderId);
                const members = users.filter((u) => u.groupId === g.id);
                return (
                  <div
                    key={g.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-xs font-semibold text-blue-700">{g.code}</div>
                        <h3 className="text-base font-semibold text-slate-900 mt-0.5">{g.name}</h3>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => openEditGroup(g)}
                          className="text-xs font-medium text-blue-700 hover:underline"
                        >
                          Chỉnh sửa
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">{g.description || '—'}</p>
                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 flex justify-between">
                      <span>
                        Trưởng nhóm:{' '}
                        <strong className="text-slate-900">{leader?.fullName || '—'}</strong>
                      </span>
                      <span className="tabular-nums">{members.length} nhân sự</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'CONFIG' && (
        <form
          onSubmit={handleSaveConfig}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-xl space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            Cấu hình khóa ngày & Nhãn nghiệp vụ (Múi giờ Asia/Ho_Chi_Minh)
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Giờ khóa log work
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="23"
                  disabled={!isAdmin}
                  value={lockHour}
                  onChange={(e) => setLockHour(e.target.value)}
                  className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
                <span>:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  disabled={!isAdmin}
                  value={lockMinute}
                  onChange={(e) => setLockMinute(e.target.value)}
                  className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Giờ nhắc nhở cuối ngày
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="23"
                  disabled={!isAdmin}
                  value={reminderHour}
                  onChange={(e) => setReminderHour(e.target.value)}
                  className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
                <span>:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  disabled={!isAdmin}
                  value={reminderMinute}
                  onChange={(e) => setReminderMinute(e.target.value)}
                  className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Danh sách nhãn mặc định (phân tách bằng dấu phẩy)
            </label>
            <input
              type="text"
              disabled={!isAdmin}
              value={labelsInput}
              onChange={(e) => setLabelsInput(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          {isAdmin && (
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
            >
              Lưu cấu hình
            </button>
          )}
        </form>
      )}

      {tab === 'DATA' && isAdmin && (
        <div className="space-y-4">
          {dataError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {dataError}
            </div>
          )}

          {importResult && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <div className="font-semibold">Import Excel hoàn tất:</div>
              <div>
                Nhân sự: <strong className="tabular-nums">{importResult.users}</strong> · Tài khoản:{' '}
                <strong className="tabular-nums">{importResult.credentials}</strong> · Nhóm:{' '}
                <strong className="tabular-nums">{importResult.groups}</strong> · Dự án:{' '}
                <strong className="tabular-nums">{importResult.projects}</strong> · Công việc:{' '}
                <strong className="tabular-nums">{importResult.tasks}</strong> · Đầu việc con:{' '}
                <strong className="tabular-nums">{importResult.subtasks}</strong> · Bình luận:{' '}
                <strong className="tabular-nums">{importResult.comments}</strong> · Nhật ký làm việc:{' '}
                <strong className="tabular-nums">{importResult.workLogs}</strong>
                {importResult.skippedLockedTasks > 0 && (
                  <span>
                    {' '}
                    · Bỏ qua {importResult.skippedLockedTasks} công việc đã khóa chỉnh sửa
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Export Excel */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <Download className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Tải toàn bộ cơ sở dữ liệu (.xlsx)
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Xuất toàn bộ bảng nhân sự, tài khoản, nhóm việc, dự án, công việc, đầu việc con, bình luận, nhật ký làm việc, cấu hình và nhật ký hệ thống thành file Excel nhiều sheet.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={exporting}
                onClick={handleExportExcel}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {exporting ? 'Đang xuất file Excel...' : 'Tải xuống cơ sở dữ liệu Excel'}
              </button>
            </div>

            {/* Import Excel */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Import cơ sở dữ liệu từ Excel (.xlsx)
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Nạp lại dữ liệu từ file Excel đã xuất (hoặc chỉnh sửa theo đúng cấu trúc cột). Có thể điền cột <code className="font-mono bg-slate-100 px-1 rounded">initialPassword</code> ở sheet <code className="font-mono bg-slate-100 px-1 rounded">NhanSu</code> để cấp mật khẩu mới cho tài khoản.
                  </p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImportFileSelected}
                className="hidden"
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {importing ? 'Đang nạp dữ liệu...' : 'Chọn file Excel (.xlsx) để Import'}
              </button>
            </div>
          </div>

          {/* Danger Zone: Wipe All Data */}
          <div className="bg-white border border-red-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-red-900">
                  Xóa toàn bộ dữ liệu hệ thống (chỉ giữ lại tài khoản Admin)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thao tác này sẽ xóa vĩnh viễn toàn bộ dự án, công việc, đầu việc con, bình luận, nhật ký làm việc, nhóm việc, cấu hình và tất cả tài khoản nhân sự khác — chỉ giữ lại duy nhất tài khoản Quản trị hệ thống hiện tại (@{currentUser.username}). Nên tải file Excel sao lưu trước khi xóa.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setWipeConfirmText('');
                setDataError('');
                setWipeModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-red-700 rounded-lg hover:bg-red-800"
            >
              <Trash2 className="w-4 h-4" />
              Xóa toàn bộ dữ liệu...
            </button>
          </div>
        </div>
      )}

      {tab === 'AUDIT' && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {auditLogs.length === 0 ? (
            <div className="py-10 px-6 text-center text-sm text-slate-500">
              Chưa có nhật ký hoạt động nào.
            </div>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="px-5 py-3 text-xs space-y-1">
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

      {/* Create / Edit User Modal */}
      {userModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                {editingUser ? `Cập nhật ${editingUser.fullName}` : 'Tạo tài khoản nhân sự mới'}
              </h3>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="overflow-y-auto px-6 py-5 space-y-4">
              {userModalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {userModalError}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Mã NV *</label>
                  <input
                    type="text"
                    required
                    value={uCode}
                    onChange={(e) => setUCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Họ và tên *
                  </label>
                  <input
                    type="text"
                    required
                    value={uName}
                    onChange={(e) => setUName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên đăng nhập *
                  </label>
                  <input
                    type="text"
                    required={!editingUser}
                    disabled={Boolean(editingUser?.username)}
                    value={uUsername}
                    onChange={(e) => setUUsername(e.target.value.toLowerCase())}
                    placeholder="vd: nguyen_an"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
                {!editingUser ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mật khẩu khởi tạo *
                    </label>
                    <input
                      type="password"
                      required
                      value={uInitialPassword}
                      onChange={(e) => setUInitialPassword(e.target.value)}
                      placeholder="Ít nhất 8 ký tự mạnh"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Chức danh
                    </label>
                    <input
                      type="text"
                      value={uTitle}
                      onChange={(e) => setUTitle(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
              </div>

              {!editingUser && (
                <p className="text-[11px] text-slate-500 -mt-2">
                  Mật khẩu phải gồm ít nhất 8 ký tự (chữ hoa, chữ thường, số và ký tự đặc biệt). Nhân sự sẽ bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email liên hệ (không dùng đăng nhập)
                  </label>
                  <input
                    type="email"
                    value={uEmail}
                    onChange={(e) => setUEmail(e.target.value)}
                    placeholder="ten@phongban.vn"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                {!editingUser && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Chức danh
                    </label>
                    <input
                      type="text"
                      value={uTitle}
                      onChange={(e) => setUTitle(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nhóm việc</label>
                  <select
                    value={uGroupId}
                    onChange={(e) => setUGroupId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Chưa phân nhóm</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Cấp trên trực tiếp
                  </label>
                  <select
                    value={uManagerId}
                    onChange={(e) => setUManagerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Không có</option>
                    {users.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Vai trò hệ thống (RBAC - chọn nhiều)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(ROLE_LABELS) as RoleCode[]).map((r) => (
                    <label
                      key={r}
                      className="flex items-center gap-2 text-xs text-slate-800 p-2 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={uRoles.includes(r)}
                        onChange={() => toggleRole(r)}
                      />
                      <span>{ROLE_LABELS[r]}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={editingUser?.uid === currentUser.uid}
                  checked={uActive}
                  onChange={(e) => setUActive(e.target.checked)}
                />
                <span>Tài khoản đang hoạt động (bỏ chọn để khóa)</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
                >
                  {savingUser ? 'Đang lưu...' : 'Lưu nhân sự'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Đặt lại mật khẩu · {resetTargetUser.fullName}
              </h3>
              <button
                type="button"
                onClick={() => setResetTargetUser(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {resetError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {resetError}
              </div>
            )}

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên đăng nhập
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(resetTargetUser.username)}
                  value={resetUsername}
                  onChange={(e) => setResetUsername(e.target.value.toLowerCase())}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  required
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Tối thiểu 8 ký tự gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nhập lại mật khẩu mới
                </label>
                <input
                  type="password"
                  required
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={resetMustChange}
                  onChange={(e) => setResetMustChange(e.target.checked)}
                />
                <span>Bắt buộc đổi mật khẩu ở lần đăng nhập tiếp theo</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setResetTargetUser(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
                >
                  {resetting ? 'Đang cập nhật...' : 'Xác nhận đặt lại'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Group Create / Edit Modal */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingGroup ? `Chỉnh sửa ${editingGroup.code}` : 'Thêm nhóm việc mới'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setGroupModalOpen(false);
                  setEditingGroup(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveGroup} className="space-y-3">
              {!editingGroup && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã nhóm *
                  </label>
                  <input
                    type="text"
                    required
                    value={gCode}
                    onChange={(e) => setGCode(e.target.value.toUpperCase())}
                    placeholder="VD: NHOM-1"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tên nhóm *</label>
                <input
                  type="text"
                  required
                  value={gName}
                  onChange={(e) => setGName(e.target.value)}
                  placeholder="VD: Nhóm 1: Hành chính tổng hợp"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mô tả</label>
                <textarea
                  rows={2}
                  value={gDesc}
                  onChange={(e) => setGDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Trưởng nhóm
                </label>
                <select
                  value={gLeader}
                  onChange={(e) => setGLeader(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">Chưa chỉ định</option>
                  {users.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.fullName} ({u.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setGroupModalOpen(false);
                    setEditingGroup(null);
                  }}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingGroup}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
                >
                  {savingGroup ? 'Đang lưu...' : 'Lưu nhóm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Wipe All Data Confirmation Modal */}
      {wipeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-red-700 font-semibold text-base">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Xác nhận xóa toàn bộ dữ liệu</span>
              </div>
              <button
                type="button"
                onClick={() => setWipeModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Toàn bộ dự án, công việc, log work, nhóm việc, cấu hình và tài khoản nhân sự khác sẽ bị xóa vĩnh viễn. Chỉ duy nhất tài khoản Quản trị hệ thống (<strong className="font-mono">@{currentUser.username}</strong>) được giữ lại.
            </p>

            <form onSubmit={handleWipeAllData} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nhập <strong className="font-mono text-red-700">XOA TOAN BO</strong> để xác nhận:
                </label>
                <input
                  type="text"
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  placeholder="XOA TOAN BO"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWipeModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={wiping || wipeConfirmText.trim().toUpperCase() !== 'XOA TOAN BO'}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-40"
                >
                  {wiping ? 'Đang xóa dữ liệu...' : 'Xác nhận xóa toàn bộ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
