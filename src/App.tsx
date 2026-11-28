import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  FolderKanban,
  Kanban,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import {
  Project,
  ROLE_LABELS,
  SystemAuditLog,
  SystemConfig,
  TaskItem,
  UserProfile,
  WorkGroup,
  WorkLog,
  WorkLogUnlock,
} from './types/domain';
import {
  auth,
  db,
  getActiveSpaceId,
  getSystemConfigDocId,
  handleFirestoreError,
  OperationType,
} from './lib/firebase';
import {
  decodeUserProfiles,
  logoutSession,
  restoreCurrentSession,
} from './lib/firestoreService';
import {
  canViewAdminSection,
  getScopedGroups,
  getScopedUsers,
  getUserScopeTier,
  getVisibleAuditLogs,
  getVisibleProjects,
  getVisibleTasks,
  getVisibleWorkLogs,
  isAdminUser,
  isLeadershipUser,
} from './lib/rbac';
import { AdminView } from './components/AdminView';
import { AuthScreen, FirstLoginPasswordScreen } from './components/AuthScreen';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { CreateTaskModal } from './components/CreateTaskModal';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { KanbanBoard } from './components/KanbanBoard';
import { MyWorkspaceView } from './components/MyWorkspaceView';
import { ProjectsView } from './components/ProjectsView';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { TaskListView } from './components/TaskListView';
import { WorkLogsView } from './components/WorkLogsView';

type NavSection =
  | 'DASHBOARD'
  | 'WORKSPACE'
  | 'KANBAN'
  | 'LIST'
  | 'PROJECTS'
  | 'WORKLOGS'
  | 'ADMIN';

const SECTION_TITLES: Record<NavSection, string> = {
  DASHBOARD: 'Tổng quan (Dashboard)',
  WORKSPACE: 'Không gian của tôi',
  KANBAN: 'Bảng công việc',
  LIST: 'Danh sách công việc',
  PROJECTS: 'Quản lý dự án',
  WORKLOGS: 'Nhật ký làm việc',
  ADMIN: 'Quản trị phòng ban',
};

function AppContent() {
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [unlocks, setUnlocks] = useState<WorkLogUnlock[]>([]);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [auditLogs, setAuditLogs] = useState<SystemAuditLog[]>([]);

  const [activeNav, setActiveNav] = useState<NavSection>('DASHBOARD');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskProjectId, setCreateTaskProjectId] = useState('');
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [changePassOpen, setChangePassOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState('');
  const [syncSuspended, setSyncSuspended] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3500);
  }

  useEffect(() => {
    let active = true;
    restoreCurrentSession().then((res) => {
      if (!active) return;
      if (res) {
        setCurrentUser(res.user);
        setMustChangePassword(res.mustChangePassword);
      } else {
        setCurrentUser(null);
        setMustChangePassword(false);
      }
      setAuthReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (!fbUser && !syncSuspended && currentUser) {
        setCurrentUser(null);
        setMustChangePassword(false);
        resetLoadedCollections();
      }
    });
    return () => unsub();
  }, [authReady, syncSuspended, currentUser]);

  function handleAuthenticated(res: { user: UserProfile; mustChangePassword: boolean }) {
    setAuthNotice('');
    setSyncSuspended(false);
    setCurrentUser(res.user);
    setMustChangePassword(res.mustChangePassword);
    setActiveNav('DASHBOARD');
  }

  function resetLoadedCollections() {
    setUsers([]);
    setGroups([]);
    setProjects([]);
    setTasks([]);
    setWorkLogs([]);
    setUnlocks([]);
    setAuditLogs([]);
    setConfig(null);
    setSelectedTaskId(null);
  }

  async function handleLogout() {
    setSyncSuspended(false);
    await logoutSession();
    setCurrentUser(null);
    setMustChangePassword(false);
    resetLoadedCollections();
    setUserMenuOpen(false);
  }

  async function handleRequireRelogin(notice: string) {
    setSyncSuspended(false);
    await logoutSession();
    setCurrentUser(null);
    setMustChangePassword(false);
    resetLoadedCollections();
    setUserMenuOpen(false);
    setAuthNotice(notice);
  }

  useEffect(() => {
    if (!authReady || !currentUser || mustChangePassword || syncSuspended) return;

    let cancelled = false;
    const spaceId = getActiveSpaceId();
    const cfgDocId = getSystemConfigDocId();

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), where('departmentId', '==', spaceId)),
      (snap) => {
        decodeUserProfiles(
          snap.docs.map((d) => d.data() as Record<string, unknown>),
          spaceId
        ).then((decoded) => {
          if (cancelled) return;
          setUsers(decoded);
          const updatedSelf = decoded.find((u) => u.uid === currentUser.uid);
          if (updatedSelf) {
            setCurrentUser(updatedSelf);
          }
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );

    const unsubGroups = onSnapshot(
      query(collection(db, 'groups'), where('departmentId', '==', spaceId)),
      (snap) => {
        setGroups(
          snap.docs
            .map((d) => d.data() as WorkGroup)
            .sort((a, b) => a.code.localeCompare(b.code))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'groups')
    );

    const unsubProjects = onSnapshot(
      query(collection(db, 'projects'), where('departmentId', '==', spaceId)),
      (snap) => {
        setProjects(snap.docs.map((d) => d.data() as Project));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'projects')
    );

    const unsubTasks = onSnapshot(
      query(collection(db, 'tasks'), where('departmentId', '==', spaceId)),
      (snap) => {
        setTasks(snap.docs.map((d) => d.data() as TaskItem));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
    );

    const unsubWorkLogs = onSnapshot(
      query(collection(db, 'workLogs'), where('departmentId', '==', spaceId)),
      (snap) => {
        setWorkLogs(snap.docs.map((d) => d.data() as WorkLog));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'workLogs')
    );

    const unsubUnlocks = onSnapshot(
      query(collection(db, 'workLogUnlocks'), where('departmentId', '==', spaceId)),
      (snap) => {
        setUnlocks(snap.docs.map((d) => d.data() as WorkLogUnlock));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'workLogUnlocks')
    );

    const unsubConfig = onSnapshot(
      doc(db, 'systemConfigs', cfgDocId),
      (snap) => {
        if (snap.exists()) {
          setConfig(snap.data() as SystemConfig);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `systemConfigs/${cfgDocId}`)
    );

    const unsubAudits = onSnapshot(
      query(collection(db, 'auditLogs'), where('departmentId', '==', spaceId)),
      (snap) => {
        setAuditLogs(snap.docs.map((d) => d.data() as SystemAuditLog));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );

    return () => {
      cancelled = true;
      unsubUsers();
      unsubGroups();
      unsubProjects();
      unsubTasks();
      unsubWorkLogs();
      unsubUnlocks();
      unsubConfig();
      unsubAudits();
    };
  }, [authReady, currentUser?.uid, mustChangePassword, syncSuspended]);

  const userTier = useMemo(() => getUserScopeTier(currentUser), [currentUser]);

  const visibleProjects = useMemo(
    () => getVisibleProjects(currentUser, projects),
    [currentUser, projects]
  );

  const visibleTasks = useMemo(
    () => getVisibleTasks(currentUser, tasks, projects, groups),
    [currentUser, tasks, projects, groups]
  );

  const visibleWorkLogs = useMemo(
    () => getVisibleWorkLogs(currentUser, workLogs, visibleTasks, projects, groups),
    [currentUser, workLogs, visibleTasks, projects, groups]
  );

  const visibleUnlocks = useMemo(() => {
    if (!currentUser) return [];
    if (isLeadershipUser(currentUser)) return unlocks;
    return unlocks.filter((ul) => ul.userId === currentUser.uid);
  }, [currentUser, unlocks]);

  const visibleAuditLogs = useMemo(
    () => getVisibleAuditLogs(currentUser, auditLogs, visibleTasks, projects),
    [currentUser, auditLogs, visibleTasks, projects]
  );

  const scopedUsers = useMemo(
    () => getScopedUsers(currentUser, users, projects, groups),
    [currentUser, users, projects, groups]
  );

  const scopedGroups = useMemo(
    () => getScopedGroups(currentUser, groups),
    [currentUser, groups]
  );

  const selectedTask = useMemo(
    () => visibleTasks.find((t) => t.id === selectedTaskId) || null,
    [visibleTasks, selectedTaskId]
  );

  const availableLabels = config?.defaultLabels || [
    'Hành chính',
    'Báo cáo định kỳ',
    'Văn bản trình ký',
    'Kiểm tra nội bộ',
    'Khẩn',
  ];

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Đang kết nối dữ liệu phòng ban...</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        onAuthenticated={handleAuthenticated}
        notice={authNotice}
      />
    );
  }

  if (mustChangePassword) {
    return (
      <FirstLoginPasswordScreen
        user={currentUser}
        onPasswordChanged={() => {
          setMustChangePassword(false);
          showToast('Đã đổi mật khẩu thành công. Chào mừng bạn vào hệ thống.');
        }}
        onSignOut={handleLogout}
      />
    );
  }

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof LayoutDashboard;
    visible: boolean;
  }> = [
    { id: 'DASHBOARD', label: 'Dashboard', icon: BarChart3, visible: true },
    { id: 'WORKSPACE', label: 'Không gian của tôi', icon: LayoutDashboard, visible: true },
    { id: 'KANBAN', label: 'Bảng công việc', icon: Kanban, visible: true },
    { id: 'LIST', label: 'Danh sách công việc', icon: ListTodo, visible: true },
    { id: 'PROJECTS', label: 'Dự án', icon: FolderKanban, visible: true },
    { id: 'WORKLOGS', label: 'Nhật ký làm việc', icon: CalendarClock, visible: true },
    {
      id: 'ADMIN',
      label: isAdminUser(currentUser) ? 'Quản trị phòng ban' : 'Cơ cấu & Nhân sự',
      icon: Settings,
      visible: canViewAdminSection(currentUser),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex w-full overflow-x-clip">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-14 px-5 flex items-center gap-2.5 border-b border-slate-200">
          <div className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <span className="text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Quản Trị Công Việc
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs space-y-1">
          <div className="font-semibold text-slate-900 truncate">{currentUser.fullName}</div>
          <div className="text-slate-500 truncate">
            {currentUser.roles.map((r) => ROLE_LABELS[r]).join(' · ')}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <span className="text-sm font-bold text-slate-900">Quản Trị Công Việc</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems
                .filter((item) => item.visible)
                .map((item) => {
                  const Icon = item.icon;
                  const active = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveNav(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg ${
                        active ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[44px] min-h-[44px] -ml-1.5 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Mở menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 whitespace-nowrap truncate max-w-[260px]">
                Phòng Hành chính – Nghiệp vụ (DAMA2)
              </span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-900 truncate text-sm sm:text-base">
                {SECTION_TITLES[activeNav]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEditingTask(null);
                setCreateTaskProjectId('');
                setCreateTaskOpen(true);
              }}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 px-3 sm:px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="sm:hidden">Tạo việc</span>
              <span className="hidden sm:inline">Giao việc / Tạo việc</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className="min-h-[38px] sm:min-h-0 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
              >
                {currentUser.employeeCode}
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-50">
                  <div className="px-4 py-2 border-b border-slate-100 text-xs">
                    <div className="font-semibold text-slate-900">{currentUser.fullName}</div>
                    <div className="font-mono text-slate-500 mt-0.5 truncate">
                      @{currentUser.username || currentUser.employeeCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setChangePassOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Đổi mật khẩu
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-red-700 hover:bg-red-50 text-left"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 px-3 py-4 pb-24 sm:p-6 lg:pb-6 max-w-[1440px] w-full mx-auto">
          {activeNav === 'DASHBOARD' && (
            <DashboardView
              currentUser={currentUser}
              tasks={visibleTasks}
              projects={visibleProjects}
              scopedUsers={scopedUsers}
              allUsers={users}
              groups={scopedGroups}
              workLogs={visibleWorkLogs}
              onSelectTask={(t) => setSelectedTaskId(t.id)}
              onNavigateList={() => setActiveNav('LIST')}
              onNavigateAdmin={() => setActiveNav('ADMIN')}
              onNavigateProjects={() => setActiveNav('PROJECTS')}
              onCreateTask={() => {
                setEditingTask(null);
                setCreateTaskProjectId('');
                setCreateTaskOpen(true);
              }}
            />
          )}

          {activeNav === 'WORKSPACE' && (
            <MyWorkspaceView
              currentUser={currentUser}
              tasks={visibleTasks}
              users={users}
              groups={groups}
              projects={visibleProjects}
              onSelectTask={(t) => setSelectedTaskId(t.id)}
              onCreateTask={() => {
                setEditingTask(null);
                setCreateTaskProjectId('');
                setCreateTaskOpen(true);
              }}
              onNotify={showToast}
            />
          )}

          {activeNav === 'KANBAN' && (
            <KanbanBoard
              tasks={visibleTasks.filter((t) => t.status !== 'HUY')}
              users={users}
              projects={visibleProjects}
              currentUser={currentUser}
              onSelectTask={(t) => setSelectedTaskId(t.id)}
              onNotify={showToast}
            />
          )}

          {activeNav === 'LIST' && (
            <TaskListView
              tasks={visibleTasks}
              users={users}
              groups={groups}
              projects={visibleProjects}
              filterUsers={scopedUsers}
              filterGroups={scopedGroups}
              hideGroupFilter={
                userTier === 'STAFF' ||
                (userTier === 'SCOPE_MANAGER' && scopedGroups.length === 0)
              }
              hideAssigneeFilter={userTier === 'STAFF'}
              onSelectTask={(t) => setSelectedTaskId(t.id)}
              onCreateTask={() => {
                setEditingTask(null);
                setCreateTaskProjectId('');
                setCreateTaskOpen(true);
              }}
            />
          )}

          {activeNav === 'PROJECTS' && (
            <ProjectsView
              currentUser={currentUser}
              projects={visibleProjects}
              tasks={visibleTasks}
              users={users}
              groups={groups}
              auditLogs={visibleAuditLogs}
              availableLabels={availableLabels}
              onSelectTask={(t) => setSelectedTaskId(t.id)}
              onCreateTaskInProject={(prjId) => {
                setEditingTask(null);
                setCreateTaskProjectId(prjId);
                setCreateTaskOpen(true);
              }}
              onNotify={showToast}
            />
          )}

          {activeNav === 'WORKLOGS' && (
            <WorkLogsView
              currentUser={currentUser}
              users={users}
              tasks={visibleTasks}
              projects={visibleProjects}
              groups={scopedGroups}
              workLogs={visibleWorkLogs}
              unlocks={visibleUnlocks}
              config={config}
              onNotify={showToast}
            />
          )}

          {activeNav === 'ADMIN' && canViewAdminSection(currentUser) && (
            <AdminView
              currentUser={currentUser}
              users={users}
              groups={groups}
              config={config}
              auditLogs={visibleAuditLogs}
              onNotify={showToast}
              onCurrentUserUpdated={(updated) => setCurrentUser(updated)}
              onSetSyncSuspended={setSyncSuspended}
              onRequireRelogin={handleRequireRelogin}
            />
          )}
        </main>
      </div>

      {/* Modals & Drawers */}
      <TaskDetailDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        currentUser={currentUser}
        users={users}
        groups={groups}
        projects={visibleProjects}
        allTasks={visibleTasks}
        onOpenEdit={(t) => {
          setEditingTask(t);
          setCreateTaskOpen(true);
        }}
        onSelectTask={(t) => setSelectedTaskId(t.id)}
        onNotify={showToast}
      />

      {createTaskOpen && (
        <CreateTaskModal
          isOpen={createTaskOpen}
          onClose={() => {
            setCreateTaskOpen(false);
            setEditingTask(null);
          }}
          currentUser={currentUser}
          users={users}
          groups={groups}
          projects={visibleProjects}
          defaultProjectId={createTaskProjectId}
          editingTask={editingTask}
          existingTaskCount={tasks.length}
          availableLabels={availableLabels}
          onSaved={showToast}
        />
      )}

      <ChangePasswordModal
        isOpen={changePassOpen}
        username={currentUser.username || ''}
        onClose={() => setChangePassOpen(false)}
        onSuccess={showToast}
      />

      {/* Mobile Fixed Bottom Thumb Navigation (< lg) */}
      <nav
        aria-label="Điều hướng nhanh"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-5 h-14 items-center">
          {(
            [
              { id: 'DASHBOARD', label: 'Tổng quan', icon: BarChart3 },
              { id: 'WORKSPACE', label: 'Của tôi', icon: LayoutDashboard },
              { id: 'KANBAN', label: 'Bảng việc', icon: Kanban },
              { id: 'LIST', label: 'Danh sách', icon: ListTodo },
              { id: 'WORKLOGS', label: 'Nhật ký', icon: CalendarClock },
            ] as Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard }>
          ).map((tabItem) => {
            const Icon = tabItem.icon;
            const active = activeNav === tabItem.id;
            return (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setActiveNav(tabItem.id)}
                className={`flex flex-col items-center justify-center h-full min-h-[44px] gap-0.5 transition-colors ${
                  active ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-medium tracking-tight leading-none truncate max-w-[68px]">
                  {tabItem.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {toast && (
        <div className="fixed bottom-20 lg:bottom-5 left-3 right-3 sm:left-auto sm:right-5 z-50 flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
