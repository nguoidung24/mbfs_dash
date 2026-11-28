import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Plus,
  Shield,
  ShieldCheck,
  Settings,
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
  auth,
  DAMA2_SUPER_ADMIN_EMAIL,
  isInternalAuthEmail,
  maskEmail,
} from '../lib/firebase';
import {
  activateLegacyUserAuthByAdmin,
  createGroupByAdmin,
  deduplicateDuplicateUsersBySuperAdmin,
  fetchUserEmailForAdmin,
  GoogleDbAdminUser,
  saveGroupByAdmin,
  saveSystemConfigByAdmin,
  saveUserByAdmin,
  signInGoogleForDbAdmin,
  signOutGoogleForDbAdmin,
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
  onSetSyncSuspended?: (suspended: boolean) => void;
  onRequireRelogin?: (notice: string) => void;
}

export function AdminView({
  currentUser,
  users,
  groups,
  config,
  auditLogs,
  onNotify,
  onCurrentUserUpdated,
  onSetSyncSuspended,
  onRequireRelogin,
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

  // Activate Firebase Auth modal (for legacy users without authUid)
  const [activateTargetUser, setActivateTargetUser] = useState<UserProfile | null>(null);
  const [activateUsername, setActivateUsername] = useState('');
  const [activatePassword, setActivatePassword] = useState('');
  const [activateConfirm, setActivateConfirm] = useState('');
  const [activateMustChange, setActivateMustChange] = useState(true);
  const [activateError, setActivateError] = useState('');
  const [activating, setActivating] = useState(false);

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

  useEffect(() => {
    setLockHour(String(config?.lockHour ?? 23));
    setLockMinute(String(config?.lockMinute ?? 59));
    setReminderHour(String(config?.reminderHour ?? 17));
    setReminderMinute(String(config?.reminderMinute ?? 30));
    setLabelsInput((config?.defaultLabels || []).join(', '));
  }, [config]);

  // Backup / Import / Wipe state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [dataError, setDataError] = useState('');
  const [wipeModalOpen, setWipeModalOpen] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wiping, setWiping] = useState(false);

  // Google (Gmail) Database Admin access state (ignores internal @dama2.app auth accounts)
  const [dbAuthUser, setDbAuthUser] = useState<GoogleDbAdminUser | null>(() => {
    const u = auth.currentUser;
    if (!u || !u.email || isInternalAuthEmail(u.email)) return null;
    return {
      uid: u.uid,
      email: u.email.trim().toLowerCase(),
      displayName: u.displayName || u.email,
    };
  });
  const [dbAuthLoading, setDbAuthLoading] = useState(false);
  const [dbAuthError, setDbAuthError] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u && u.email && !isInternalAuthEmail(u.email)) {
        setDbAuthUser({
          uid: u.uid,
          email: u.email.trim().toLowerCase(),
          displayName: u.displayName || u.email,
        });
      } else {
        setDbAuthUser(null);
      }
    });
    return () => unsub();
  }, []);

  const isDbAdminUnlocked =
    Boolean(dbAuthUser) && dbAuthUser?.email === DAMA2_SUPER_ADMIN_EMAIL;

  const [dedupingUsername, setDedupingUsername] = useState<string | null>(null);
  const [dedupeError, setDedupeError] = useState('');

  const duplicateUsernameGroups = useMemo(() => {
    const grouped = new Map<string, UserProfile[]>();
    for (const u of users) {
      const uname = (u.username || '').trim().toLowerCase();
      if (!uname) continue;
      const list = grouped.get(uname) || [];
      list.push(u);
      grouped.set(uname, list);
    }
    return Array.from(grouped.entries())
      .filter(([, list]) => list.length > 1)
      .map(([username, list]) => ({ username, list }));
  }, [users]);

  const duplicatedUidSet = useMemo(() => {
    const set = new Set<string>();
    for (const grp of duplicateUsernameGroups) {
      for (const u of grp.list) set.add(u.uid);
    }
    return set;
  }, [duplicateUsernameGroups]);

  async function handleDeduplicateUsername(username: string, list: UserProfile[]) {
    setDedupeError('');
    if (!isDbAdminUnlocked) {
      onNotify(
        'Vui lòng mở khóa quyền Quản trị CSDL bằng Gmail quản trị ở tab "Sao lưu & Dữ liệu" trước khi gộp & xóa tài khoản trùng.'
      );
      setTab('DATA');
      return;
    }
    setDedupingUsername(username);
    try {
      const res = await deduplicateDuplicateUsersBySuperAdmin({
        username,
        duplicateUsers: list,
        actor: currentUser,
        allUsers: users,
      });
      if (list.some((u) => u.uid === currentUser.uid)) {
        onCurrentUserUpdated?.(res.survivor);
      }
      onNotify(`Đã gộp và xóa ${res.removedCount} bản ghi trùng của tài khoản @${username}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể gộp tài khoản trùng.';
      setDedupeError(msg);
      onNotify(msg);
    } finally {
      setDedupingUsername(null);
    }
  }

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

  function openActivateModal(u: UserProfile) {
    setActivateTargetUser(u);
    setActivateUsername(u.username || u.employeeCode.toLowerCase().replace(/[^a-z0-9]/g, ''));
    setActivatePassword('');
    setActivateConfirm('');
    setActivateMustChange(true);
    setActivateError('');
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
          ? 'Đã cập nhật & mã hóa hồ sơ nhân sự.'
          : 'Đã tạo tài khoản Firebase Auth mới (người dùng sẽ phải đổi mật khẩu ở lần đăng nhập đầu).'
      );
    } catch (err) {
      setUserModalError(err instanceof Error ? err.message : 'Không thể lưu tài khoản nhân sự.');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleActivateLegacyAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activateTargetUser) return;
    setActivateError('');
    if (activatePassword !== activateConfirm) {
      setActivateError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setActivating(true);
    try {
      await activateLegacyUserAuthByAdmin({
        targetUser: activateTargetUser,
        usernameInput: activateUsername,
        initialPassword: activatePassword,
        requireChangeOnNextLogin: activateMustChange,
        actor: currentUser,
        allUsers: users,
      });
      setActivateTargetUser(null);
      onNotify(`Đã kích hoạt Firebase Auth & mã hóa tài khoản cho ${activateTargetUser.fullName}.`);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : 'Không thể kích hoạt tài khoản.');
    } finally {
      setActivating(false);
    }
  }

  async function handleToggleLockUser(u: UserProfile) {
    if (!isAdmin || u.uid === currentUser.uid) return;
    try {
      await toggleUserLockByAdmin({
        targetUser: u,
        nextActive: !u.isActive,
        actor: currentUser,
        allUsers: users,
      });
      onNotify(u.isActive ? `Đã khóa tài khoản ${u.fullName}.` : `Đã mở khóa ${u.fullName}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể thay đổi trạng thái khóa tài khoản.');
    }
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
      onNotify(`Đã xóa ${res.deletedDocs} bản ghi dữ liệu và toàn bộ tài khoản khác, chỉ giữ lại tài khoản Quản trị (@${res.normalizedAdmin.username || 'mbfs_admin'}).`);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Không thể xóa dữ liệu.');
    } finally {
      setWiping(false);
    }
  }

  async function handleGoogleDbSignIn() {
    setDbAuthError('');
    setDbAuthLoading(true);
    onSetSyncSuspended?.(true);
    try {
      const gUser = await signInGoogleForDbAdmin();
      if (gUser.email === DAMA2_SUPER_ADMIN_EMAIL) {
        onSetSyncSuspended?.(false);
        onNotify(
          `Đã mở khóa quyền quản trị cơ sở dữ liệu DAMA2 cho ${maskEmail(gUser.email)}.`
        );
        return;
      }

      await signOutGoogleForDbAdmin();
      onSetSyncSuspended?.(false);
      onRequireRelogin?.(
        `Tài khoản Google ${maskEmail(gUser.email)} không có quyền Quản trị Cơ sở dữ liệu DAMA2. Vui lòng đăng nhập lại bằng tài khoản nội bộ.`
      );
    } catch (err) {
      onSetSyncSuspended?.(false);
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg.includes('popup-closed-by-user')) {
        setDbAuthError('Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.');
      } else if (rawMsg.includes('unauthorized-domain')) {
        setDbAuthError(
          'Tên miền hiện tại chưa được cấp phép đăng nhập Google trong Firebase Authentication (Authorized domains).'
        );
      } else {
        setDbAuthError(rawMsg || 'Không thể đăng nhập Google để quản trị cơ sở dữ liệu.');
      }
    } finally {
      setDbAuthLoading(false);
    }
  }

  async function handleSignOutGoogleDbAdmin() {
    setDbAuthError('');
    await signOutGoogleForDbAdmin();
    onSetSyncSuspended?.(false);
    onRequireRelogin?.(
      'Đã đăng xuất tài khoản Google quản trị cơ sở dữ liệu. Vui lòng đăng nhập lại tài khoản nội bộ.'
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
        <div className="flex sm:inline-flex items-center p-1 bg-slate-100 rounded-lg gap-1 overflow-x-auto no-scrollbar max-w-full">
          <button
            type="button"
            onClick={() => setTab('USERS')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              tab === 'USERS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Nhân sự & Tài khoản ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('GROUPS')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              tab === 'GROUPS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Nhóm việc ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('CONFIG')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
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
              className={`inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
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
            className={`px-3 py-2 sm:py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
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
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Tạo tài khoản nhân sự
          </button>
        )}

        {isAdmin && tab === 'GROUPS' && (
          <button
            type="button"
            onClick={openCreateGroup}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Thêm nhóm việc
          </button>
        )}
      </div>

      {tab === 'USERS' && (
        <div className="space-y-4">
          {isAdmin && duplicateUsernameGroups.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="space-y-1 text-xs text-amber-900">
                  <div className="font-semibold text-sm">
                    Phát hiện tài khoản trùng tên đăng nhập trong cơ sở dữ liệu
                  </div>
                  <p className="text-amber-800 leading-relaxed">
                    Nguyên nhân thường gặp là do hồ sơ cũ hoặc bản khôi phục Excel dùng mã tài liệu
                    (Document ID) khác với bản ghi chuẩn <span className="font-mono">usr_mbfs_admin</span>,
                    khiến cùng một <span className="font-mono">@username</span> tồn tại 2 bản ghi độc lập.
                  </p>
                </div>
              </div>

              {dedupeError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {dedupeError}
                </div>
              )}

              <div className="space-y-2">
                {duplicateUsernameGroups.map(({ username, list }) => (
                  <div
                    key={username}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-amber-200 rounded-lg px-3.5 py-2.5"
                  >
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-slate-900">
                        <span className="font-mono">@{username}</span> ·{' '}
                        <span className="tabular-nums">{list.length}</span> bản ghi trùng
                      </div>
                      <div className="text-[11px] text-slate-600 font-mono break-all">
                        ID: {list.map((item) => item.uid).join(' · ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={dedupingUsername === username}
                      onClick={() => handleDeduplicateUsername(username, list)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-700 rounded-lg hover:bg-amber-800 disabled:opacity-60 whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {dedupingUsername === username
                        ? 'Đang gộp...'
                        : isDbAdminUnlocked
                        ? 'Gộp & xóa bản trùng'
                        : 'Mở khóa Gmail để gộp bản trùng'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Mobile User Cards (< md) */}
            <div className="md:hidden divide-y divide-slate-100">
              {users.map((u) => {
                const grp = groups.find((g) => g.id === u.groupId);
                const mgr = users.find((m) => m.uid === u.managerId);
                const isDup = duplicatedUidSet.has(u.uid);
                return (
                  <div key={u.uid} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-medium text-slate-600">
                            {u.employeeCode}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="font-mono text-slate-700 truncate">
                            {u.username ? `@${u.username}` : '—'}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-slate-900 mt-0.5">
                          {u.fullName}
                        </div>
                        <div className="text-xs text-slate-500">
                          {u.title || '—'} · {grp?.name || 'Chưa phân nhóm'}
                        </div>
                        {isDup && (
                          <div className="text-[11px] font-mono text-amber-700 mt-0.5 break-all">
                            ID: {u.uid}
                          </div>
                        )}
                      </div>
                      <span
                        className={`text-xs whitespace-nowrap shrink-0 ${
                          !u.isActive
                            ? 'text-red-700 font-medium'
                            : u.authUid
                            ? 'text-emerald-700 font-medium'
                            : 'text-amber-700 font-medium'
                        }`}
                      >
                        {!u.isActive
                          ? 'Đã khóa'
                          : u.authUid
                          ? 'Đang hoạt động'
                          : 'Chưa kích hoạt Auth'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600">
                      <span>{u.roles.map((r) => ROLE_LABELS[r]).join(' · ')}</span>
                      {mgr && (
                        <>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span>Cấp trên: {mgr.fullName}</span>
                        </>
                      )}
                    </div>

                    {isAdmin && (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => openEditUser(u)}
                          className="inline-flex items-center gap-1 min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Sửa
                        </button>
                        {!u.authUid && (
                          <button
                            type="button"
                            onClick={() => openActivateModal(u)}
                            className="inline-flex items-center gap-1 min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 rounded-lg"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Kích hoạt Auth
                          </button>
                        )}
                        {u.uid !== currentUser.uid && (
                          <button
                            type="button"
                            onClick={() => handleToggleLockUser(u)}
                            className="inline-flex items-center gap-1 min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
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
                    const isDup = duplicatedUidSet.has(u.uid);
                    return (
                      <tr key={u.uid} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {u.employeeCode}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                          <div>
                            {u.username ? `@${u.username}` : <span className="text-slate-400">—</span>}
                          </div>
                          {isDup && (
                            <div className="text-[11px] text-amber-700">ID: {u.uid}</div>
                          )}
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
                            !u.isActive
                              ? 'text-red-700 font-medium'
                              : u.authUid
                              ? 'text-emerald-700 font-medium'
                              : 'text-amber-700 font-medium'
                          }
                        >
                          {!u.isActive
                            ? 'Đã khóa'
                            : u.authUid
                            ? 'Đang hoạt động'
                            : 'Chưa kích hoạt Auth'}
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
                          {!u.authUid && (
                            <button
                              type="button"
                              onClick={() => openActivateModal(u)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              Kích hoạt Auth
                            </button>
                          )}
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
                Giờ khóa nhật ký ngày
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

          {/* Google Database Admin Gate (DAMA2) */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Xác thực Gmail Quản trị Cơ sở dữ liệu DAMA2
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                    Chỉ tài khoản Google quản trị hệ thống của phòng ban DAMA2 mới có quyền mở khóa thao tác xuất/nhập Excel và xóa toàn bộ dữ liệu trên máy chủ Firestore.
                  </p>
                </div>
              </div>

              <div className="px-3.5 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-0.5 min-w-[220px]">
                <div className="text-slate-500">Cơ sở dữ liệu phòng ban:</div>
                <div className="font-semibold text-slate-900">Phòng Hành chính – Nghiệp vụ (DAMA2)</div>
              </div>
            </div>

            {dbAuthError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed">
                {dbAuthError}
              </div>
            )}

            {isDbAdminUnlocked && dbAuthUser ? (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-emerald-950">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div>
                      Đã mở khóa quyền quản trị CSDL bằng Gmail:{' '}
                      <strong className="font-semibold">{maskEmail(dbAuthUser.email)}</strong>
                    </div>
                    <div className="text-emerald-800">
                      Bạn đang có quyền xuất/nhập file Excel và quản trị dữ liệu hệ thống DAMA2.
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSignOutGoogleDbAdmin}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Đăng xuất Gmail
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-950 max-w-xl">
                  <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1 leading-relaxed">
                    <div className="font-semibold">
                      Quyền quản trị cơ sở dữ liệu đang bị khóa
                    </div>
                    <div>
                      Chỉ tài khoản Google quản trị hệ thống ({maskEmail(DAMA2_SUPER_ADMIN_EMAIL)}) mới được phép mở khóa tính năng xuất/nhập Excel và xóa toàn bộ dữ liệu của DAMA2.
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={dbAuthLoading}
                    onClick={handleGoogleDbSignIn}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
                  >
                    <Mail className="w-4 h-4" />
                    {dbAuthLoading ? 'Đang xác thực Google...' : 'Đăng nhập bằng Google (Gmail)'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {importResult && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
              <div className="font-semibold">Import Excel hoàn tất:</div>
              <div>
                Nhân sự: <strong className="tabular-nums">{importResult.users}</strong> · Tài khoản Auth mới cấp:{' '}
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
                {importResult.skippedUsersNoAuth > 0 && (
                  <span className="text-amber-800">
                    {' '}
                    · Bỏ qua {importResult.skippedUsersNoAuth} nhân sự chưa có mật khẩu khởi tạo (cột initialPassword)
                  </span>
                )}
              </div>
            </div>
          )}

          <div
            className={`grid grid-cols-1 lg:grid-cols-2 gap-4 transition-opacity ${
              isDbAdminUnlocked ? '' : 'opacity-60'
            }`}
          >
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
                    Giải mã và xuất toàn bộ bảng nhân sự, nhóm việc, dự án, công việc, đầu việc con, bình luận, nhật ký làm việc, cấu hình và nhật ký hệ thống thành file Excel nhiều sheet.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={!isDbAdminUnlocked || exporting}
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
                    Nạp và tự động mã hóa lại dữ liệu từ file Excel. Với nhân sự mới, điền cột <code className="font-mono bg-slate-100 px-1 rounded">initialPassword</code> ở sheet <code className="font-mono bg-slate-100 px-1 rounded">NhanSu</code> để cấp tài khoản Firebase Auth.
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
                disabled={!isDbAdminUnlocked || importing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {importing ? 'Đang nạp dữ liệu...' : 'Chọn file Excel (.xlsx) để Import'}
              </button>
            </div>
          </div>

          {/* Danger Zone: Wipe All Data */}
          <div
            className={`bg-white border border-red-200 rounded-xl p-6 space-y-4 transition-opacity ${
              isDbAdminUnlocked ? '' : 'opacity-60'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-red-900">
                  Xóa toàn bộ dữ liệu &amp; tài khoản (chỉ giữ lại tài khoản Quản trị)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thao tác này sẽ xóa vĩnh viễn toàn bộ dự án, công việc, đầu việc con, bình luận, nhật ký làm việc, nhóm việc, cấu hình và <strong>tất cả các tài khoản nhân sự/lãnh đạo khác</strong> — chỉ giữ lại duy nhất tài khoản Quản trị hệ thống (@{currentUser.username}). Nên tải file Excel sao lưu trước khi xóa.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!isDbAdminUnlocked}
              onClick={() => {
                setWipeConfirmText('');
                setDataError('');
                setWipeModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4">
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl w-full max-w-lg max-h-[92vh] flex flex-col pb-safe">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900 truncate pr-2">
                {editingUser ? `Cập nhật ${editingUser.fullName}` : 'Tạo tài khoản nhân sự mới'}
              </h3>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
              {userModalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {userModalError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                <div className="sm:col-span-2">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên đăng nhập *
                  </label>
                  <input
                    type="text"
                    required={!editingUser || !editingUser.authUid}
                    disabled={Boolean(editingUser?.username && editingUser?.authUid)}
                    value={uUsername}
                    onChange={(e) => setUUsername(e.target.value.toLowerCase())}
                    placeholder="vd: nguyen_an"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
                {!editingUser || !editingUser.authUid ? (
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

              {(!editingUser || !editingUser.authUid) ? (
                <p className="text-[11px] text-slate-500 -mt-2">
                  Mật khẩu phải gồm ít nhất 8 ký tự (chữ hoa, chữ thường, số và ký tự đặc biệt). Nhân sự sẽ bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
                </p>
              ) : (
                <p className="text-[11px] text-slate-500 -mt-2">
                  Tài khoản xác thực qua Firebase Authentication; nhân sự tự đổi mật khẩu cá nhân sau khi đăng nhập.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email liên hệ (mã hóa AES-256)
                  </label>
                  <input
                    type="email"
                    value={uEmail}
                    onChange={(e) => setUEmail(e.target.value)}
                    placeholder="ten@phongban.vn"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                {(!editingUser || !editingUser.authUid) && (
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

      {/* Activate Firebase Auth Modal (legacy unlinked users only) */}
      {activateTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Kích hoạt Firebase Auth · {activateTargetUser.fullName}
              </h3>
              <button
                type="button"
                onClick={() => setActivateTargetUser(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {activateError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {activateError}
              </div>
            )}

            <form onSubmit={handleActivateLegacyAuthSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên đăng nhập
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(activateTargetUser.username)}
                  value={activateUsername}
                  onChange={(e) => setActivateUsername(e.target.value.toLowerCase())}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mật khẩu khởi tạo
                </label>
                <input
                  type="password"
                  required
                  value={activatePassword}
                  onChange={(e) => setActivatePassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Tối thiểu 8 ký tự gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nhập lại mật khẩu khởi tạo
                </label>
                <input
                  type="password"
                  required
                  value={activateConfirm}
                  onChange={(e) => setActivateConfirm(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={activateMustChange}
                  onChange={(e) => setActivateMustChange(e.target.checked)}
                />
                <span>Bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setActivateTargetUser(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={activating}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
                >
                  {activating ? 'Đang kích hoạt...' : 'Xác nhận kích hoạt'}
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
              Toàn bộ dự án, công việc, nhật ký làm việc, nhóm việc, cấu hình và <strong>tất cả tài khoản khác</strong> sẽ bị xóa vĩnh viễn. Chỉ duy nhất 1 tài khoản Quản trị hệ thống (<strong className="font-mono">@{currentUser.username}</strong>) được giữ lại.
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
