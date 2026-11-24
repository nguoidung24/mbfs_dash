import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
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
  DEPARTMENT_ID,
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
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { logoutSession, restoreCurrentSession } from './lib/firestoreService';
import {
  canViewAdminSection,
  getVisibleTasks,
  isAdminUser,
  isLeadershipUser,
} from './lib/rbac';
import { AdminView } from './components/AdminView';
import { AuthScreen, FirstLoginPasswordScreen } from './components/AuthScreen';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { CreateTaskModal } from './components/CreateTaskModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { KanbanBoard } from './components/KanbanBoard';
import { MyWorkspaceView } from './components/MyWorkspaceView';
import { ProjectsView } from './components/ProjectsView';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { TaskListView } from './components/TaskListView';
import { WorkLogsView } from './components/WorkLogsView';

type NavSection = 'WORKSPACE' | 'KANBAN' | 'LIST' | 'PROJECTS' | 'WORKLOGS' | 'ADMIN';

const SECTION_TITLES: Record<NavSection, string> = {
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

  const [activeNav, setActiveNav] = useState<NavSection>('WORKSPACE');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskProjectId, setCreateTaskProjectId] = useState('');
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [changePassOpen, setChangePassOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  function handleAuthenticated(res: { user: UserProfile; mustChangePassword: boolean }) {
    setCurrentUser(res.user);
    setMustChangePassword(res.mustChangePassword);
    setActiveNav('WORKSPACE');
  }

  function handleLogout() {
    logoutSession();
    setCurrentUser(null);
    setMustChangePassword(false);
    setUsers([]);
    setGroups([]);
    setProjects([]);
    setTasks([]);
    setWorkLogs([]);
    setUnlocks([]);
    setAuditLogs([]);
    setSelectedTaskId(null);
    setUserMenuOpen(false);
  }

  useEffect(() => {
    if (!authReady || !currentUser || mustChangePassword) return;

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), where('departmentId', '==', DEPARTMENT_ID)),
      (snap) => {
        setUsers(snap.docs.map((d) => d.data() as UserProfile));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );

    const unsubGroups = onSnapshot(
      query(collection(db, 'groups'), where('departmentId', '==', DEPARTMENT_ID)),
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
      query(collection(db, 'projects'), where('departmentId', '==', DEPARTMENT_ID)),
      (snap) => {
        setProjects(snap.docs.map((d) => d.data() as Project));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'projects')
    );

    const unsubTasks = onSnapshot(
      query(collection(db, 'tasks'), where('departmentId', '==', DEPARTMENT_ID)),
      (snap) => {
        setTasks(snap.docs.map((d) => d.data() as TaskItem));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
    );

    const unsubWorkLogs = onSnapshot(
      query(collection(db, 'workLogs'), where('departmentId', '==', DEPARTMENT_ID)),
      (snap) => {
        setWorkLogs(snap.docs.map((d) => d.data() as WorkLog));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'workLogs')
    );

    const unsubUnlocks = onSnapshot(
      query(collection(db, 'workLogUnlocks'), where('departmentId', '==', DEPARTMENT_ID)),
      (snap) => {
        setUnlocks(snap.docs.map((d) => d.data() as WorkLogUnlock));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'workLogUnlocks')
    );

    const unsubConfig = onSnapshot(
      doc(db, 'systemConfigs', 'department'),
      (snap) => {
        if (snap.exists()) {
          setConfig(snap.data() as SystemConfig);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'systemConfigs/department')
    );

    const unsubAudits = onSnapshot(
      query(collection(db, 'auditLogs'), where('departmentId', '==', DEPARTMENT_ID)),
      (snap) => {
        setAuditLogs(snap.docs.map((d) => d.data() as SystemAuditLog));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );

    return () => {
      unsubUsers();
      unsubGroups();
      unsubProjects();
      unsubTasks();
      unsubWorkLogs();
      unsubUnlocks();
      unsubConfig();
      unsubAudits();
    };
  }, [authReady, currentUser?.uid, mustChangePassword]);

  const visibleProjects = useMemo(() => {
    if (!currentUser) return [];
    if (isLeadershipUser(currentUser)) return projects;
    return projects.filter(
      (p) => p.pmId === currentUser.uid || p.memberIds.includes(currentUser.uid)
    );
  }, [currentUser, projects]);

  const visibleTasks = useMemo(
    () => getVisibleTasks(currentUser, tasks, visibleProjects),
    [currentUser, tasks, visibleProjects]
  );

  const visibleWorkLogs = useMemo(() => {
    if (!currentUser) return [];
    if (isLeadershipUser(currentUser)) return workLogs;
    return workLogs.filter(
      (w) => w.userId === currentUser.uid || w.viewerIds.includes(currentUser.uid)
    );
  }, [currentUser, workLogs]);

  const visibleUnlocks = useMemo(() => {
    if (!currentUser) return [];
    if (isLeadershipUser(currentUser)) return unlocks;
    return unlocks.filter((ul) => ul.userId === currentUser.uid);
  }, [currentUser, unlocks]);

  const visibleAuditLogs = useMemo(() => {
    if (!currentUser) return [];
    if (isLeadershipUser(currentUser)) return auditLogs;
    return auditLogs.filter((a) => a.viewerIds.includes(currentUser.uid));
  }, [currentUser, auditLogs]);

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
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
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
    <div className="min-h-screen bg-slate-50 flex">
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
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Mở menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 whitespace-nowrap">
                Phòng Hành chính – Nghiệp vụ
              </span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-900 truncate">
                {SECTION_TITLES[activeNav]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEditingTask(null);
                setCreateTaskProjectId('');
                setCreateTaskOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Giao việc / Tạo việc</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
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
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Đổi mật khẩu
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs text-red-700 hover:bg-red-50 text-left"
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
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
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

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-lg">
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
