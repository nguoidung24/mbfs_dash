import {
  Project,
  RoleCode,
  SystemAuditLog,
  TaskItem,
  UserProfile,
  WorkGroup,
  WorkLog,
} from '../types/domain';

export type UserScopeTier =
  | 'SYSTEM_ADMIN'
  | 'DEPARTMENT_HEAD'
  | 'SCOPE_MANAGER'
  | 'STAFF';

export function hasRole(user: UserProfile | null | undefined, role: RoleCode): boolean {
  if (!user || !user.isActive) return false;
  return user.roles.includes(role);
}

export function isAdminUser(user: UserProfile | null | undefined): boolean {
  return hasRole(user, 'ADMIN');
}

export function isLeadershipUser(user: UserProfile | null | undefined): boolean {
  if (!user || !user.isActive) return false;
  return (
    user.roles.includes('ADMIN') ||
    user.roles.includes('TRUONG_PHONG') ||
    user.roles.includes('PHO_PHONG')
  );
}

export function getUserScopeTier(user: UserProfile | null | undefined): UserScopeTier {
  if (!user || !user.isActive) return 'STAFF';
  if (user.roles.includes('ADMIN')) return 'SYSTEM_ADMIN';
  if (user.roles.includes('TRUONG_PHONG') || user.roles.includes('PHO_PHONG')) {
    return 'DEPARTMENT_HEAD';
  }
  if (user.roles.includes('QUAN_LY_DU_AN') || user.roles.includes('TRUONG_NHOM')) {
    return 'SCOPE_MANAGER';
  }
  return 'STAFF';
}

export function getRoleRank(user: UserProfile | null | undefined): number {
  if (!user) return 0;
  if (user.roles.includes('ADMIN') || user.roles.includes('TRUONG_PHONG')) return 4;
  if (user.roles.includes('PHO_PHONG')) return 3;
  if (user.roles.includes('TRUONG_NHOM') || user.roles.includes('QUAN_LY_DU_AN')) return 2;
  return 1;
}

export function canManageUsers(user: UserProfile | null | undefined): boolean {
  return isAdminUser(user);
}

export function canViewAdminSection(user: UserProfile | null | undefined): boolean {
  return isLeadershipUser(user);
}

export function canCreateProject(user: UserProfile | null | undefined): boolean {
  if (!user || !user.isActive) return false;
  return isLeadershipUser(user) || hasRole(user, 'QUAN_LY_DU_AN');
}

export function canEditProject(user: UserProfile | null | undefined, project: Project): boolean {
  if (!user || !user.isActive) return false;
  if (isLeadershipUser(user)) return true;
  return project.pmId === user.uid;
}

export function canManageProjectMembers(user: UserProfile | null | undefined): boolean {
  if (!user || !user.isActive) return false;
  return isAdminUser(user) || hasRole(user, 'TRUONG_PHONG');
}

export function canUnlockWorkLog(user: UserProfile | null | undefined): boolean {
  return isLeadershipUser(user);
}

export function getManagedProjects(
  actor: UserProfile | null | undefined,
  projects: Project[]
): Project[] {
  if (!actor || !actor.isActive) return [];
  if (isLeadershipUser(actor)) return projects;
  if (hasRole(actor, 'QUAN_LY_DU_AN')) {
    return projects.filter((p) => p.pmId === actor.uid);
  }
  return [];
}

export function getVisibleProjects(
  actor: UserProfile | null | undefined,
  projects: Project[]
): Project[] {
  if (!actor || !actor.isActive) return [];
  if (isLeadershipUser(actor)) return projects;
  return projects.filter(
    (p) => p.pmId === actor.uid || p.memberIds.includes(actor.uid)
  );
}

export function getManagedGroupIds(
  actor: UserProfile | null | undefined,
  groups: WorkGroup[] = []
): Set<string> {
  const ids = new Set<string>();
  if (!actor || !actor.isActive) return ids;
  if (isLeadershipUser(actor)) {
    for (const g of groups) ids.add(g.id);
    return ids;
  }
  if (hasRole(actor, 'TRUONG_NHOM')) {
    if (actor.groupId) ids.add(actor.groupId);
    for (const g of groups) {
      if (g.leaderId === actor.uid) ids.add(g.id);
    }
  }
  return ids;
}

export function getScopedGroups(
  actor: UserProfile | null | undefined,
  groups: WorkGroup[]
): WorkGroup[] {
  if (!actor || !actor.isActive) return [];
  if (isLeadershipUser(actor)) return groups;
  const managedIds = getManagedGroupIds(actor, groups);
  if (managedIds.size === 0) return [];
  return groups.filter((g) => managedIds.has(g.id));
}

export function getScopedUsers(
  actor: UserProfile | null | undefined,
  allUsers: UserProfile[],
  projects: Project[],
  groups: WorkGroup[] = []
): UserProfile[] {
  if (!actor || !actor.isActive) return [];
  const activeUsers = allUsers.filter((u) => u.isActive);
  if (isLeadershipUser(actor)) return activeUsers;

  const tier = getUserScopeTier(actor);
  if (tier === 'STAFF') {
    const self = activeUsers.find((u) => u.uid === actor.uid) || actor;
    return [self];
  }

  const allowedIds = new Set<string>([actor.uid]);
  const managedProjects = getManagedProjects(actor, projects);
  for (const p of managedProjects) {
    if (p.pmId) allowedIds.add(p.pmId);
    for (const m of p.memberIds) allowedIds.add(m);
  }
  const managedGroupIds = getManagedGroupIds(actor, groups);
  if (managedGroupIds.size > 0) {
    for (const u of activeUsers) {
      if (u.groupId && managedGroupIds.has(u.groupId)) {
        allowedIds.add(u.uid);
      }
    }
  }
  return activeUsers.filter((u) => allowedIds.has(u.uid));
}

/**
 * Principle: Cannot assign upwards.
 * - Admin / Trưởng phòng: assign to any active user.
 * - Phó phòng: assign to any active user except Trưởng phòng / Admin.
 * - Quản lý dự án: assign to members of projects they manage (p.pmId === actor.uid).
 * - Trưởng nhóm: assign to members of their group.
 * - Chuyên viên: cannot assign to others (only self-create).
 */
export function getAssignableUsers(
  actor: UserProfile,
  allUsers: UserProfile[],
  selectedProject?: Project | null,
  projects: Project[] = [],
  groups: WorkGroup[] = []
): UserProfile[] {
  const activeUsers = allUsers.filter((u) => u.isActive);
  if (isAdminUser(actor) || hasRole(actor, 'TRUONG_PHONG')) {
    return activeUsers;
  }
  if (hasRole(actor, 'PHO_PHONG')) {
    return activeUsers.filter(
      (u) => !u.roles.includes('TRUONG_PHONG') && !u.roles.includes('ADMIN')
    );
  }

  const allowedSet = new Map<string, UserProfile>();
  allowedSet.set(actor.uid, actor);

  const isHigherRank = (u: UserProfile) =>
    u.roles.includes('ADMIN') ||
    u.roles.includes('TRUONG_PHONG') ||
    u.roles.includes('PHO_PHONG');

  if (selectedProject) {
    if (selectedProject.pmId === actor.uid) {
      for (const u of activeUsers) {
        if (selectedProject.memberIds.includes(u.uid) && !isHigherRank(u)) {
          allowedSet.set(u.uid, u);
        }
      }
    }
  } else if (hasRole(actor, 'QUAN_LY_DU_AN')) {
    const managedMemberIds = new Set<string>();
    for (const p of getManagedProjects(actor, projects)) {
      for (const m of p.memberIds) managedMemberIds.add(m);
    }
    for (const u of activeUsers) {
      if (managedMemberIds.has(u.uid) && !isHigherRank(u)) {
        allowedSet.set(u.uid, u);
      }
    }
  }

  if (hasRole(actor, 'TRUONG_NHOM')) {
    const managedGroupIds = getManagedGroupIds(actor, groups);
    for (const u of activeUsers) {
      if (u.groupId && managedGroupIds.has(u.groupId) && !isHigherRank(u)) {
        allowedSet.set(u.uid, u);
      }
    }
  }

  return Array.from(allowedSet.values());
}

export function canAssignToOthers(actor: UserProfile | null | undefined, projects: Project[]): boolean {
  if (!actor || !actor.isActive) return false;
  if (isLeadershipUser(actor) || hasRole(actor, 'TRUONG_NHOM')) return true;
  if (hasRole(actor, 'QUAN_LY_DU_AN') && projects.some((p) => p.pmId === actor.uid)) return true;
  return false;
}

export function canReviewTask(
  actor: UserProfile | null | undefined,
  task: TaskItem,
  projects: Project[],
  groups: WorkGroup[] = []
): boolean {
  if (!actor || !actor.isActive) return false;
  if (isLeadershipUser(actor)) return true;
  if (task.reviewerId === actor.uid) return true;
  const project = task.projectId ? projects.find((p) => p.id === task.projectId) : undefined;
  if (project && project.pmId === actor.uid) return true;
  if (hasRole(actor, 'TRUONG_NHOM')) {
    const managedGroupIds = getManagedGroupIds(actor, groups);
    if (task.groupId && managedGroupIds.has(task.groupId)) return true;
  }
  return false;
}

export function canEditTaskMetadata(
  actor: UserProfile | null | undefined,
  task: TaskItem,
  projects: Project[],
  groups: WorkGroup[] = []
): boolean {
  if (!actor || !actor.isActive) return false;
  if (task.isLocked && !isAdminUser(actor)) return false;
  if (isLeadershipUser(actor)) return true;
  if (task.creatorId === actor.uid) return true;
  return canReviewTask(actor, task, projects, groups);
}

export function canCancelTask(
  actor: UserProfile | null | undefined,
  task: TaskItem,
  projects: Project[],
  groups: WorkGroup[] = []
): boolean {
  if (!actor || !actor.isActive) return false;
  if (task.isLocked) return false;
  if (isLeadershipUser(actor)) return true;
  if (task.creatorId === actor.uid && task.assigneeId !== actor.uid) return true;
  return canReviewTask(actor, task, projects, groups);
}

export function getVisibleTasks(
  actor: UserProfile | null | undefined,
  tasks: TaskItem[],
  projects: Project[],
  groups: WorkGroup[] = []
): TaskItem[] {
  if (!actor || !actor.isActive) return [];
  if (isLeadershipUser(actor)) return tasks;

  const tier = getUserScopeTier(actor);
  if (tier === 'STAFF') {
    return tasks.filter(
      (t) =>
        t.creatorId === actor.uid ||
        t.assigneeId === actor.uid ||
        t.reviewerId === actor.uid
    );
  }

  // SCOPE_MANAGER (QUAN_LY_DU_AN / TRUONG_NHOM): strictly own tasks + projects they manage (PM) + groups they lead
  const managedProjectIds = new Set(
    getManagedProjects(actor, projects).map((p) => p.id)
  );
  const managedGroupIds = getManagedGroupIds(actor, groups);

  return tasks.filter((t) => {
    if (
      t.creatorId === actor.uid ||
      t.assigneeId === actor.uid ||
      t.reviewerId === actor.uid
    ) {
      return true;
    }
    if (t.projectId && managedProjectIds.has(t.projectId)) {
      return true;
    }
    if (hasRole(actor, 'TRUONG_NHOM') && t.groupId && managedGroupIds.has(t.groupId)) {
      return true;
    }
    return false;
  });
}

export function getVisibleWorkLogs(
  actor: UserProfile | null | undefined,
  workLogs: WorkLog[],
  visibleTasks: TaskItem[],
  projects: Project[],
  groups: WorkGroup[] = []
): WorkLog[] {
  if (!actor || !actor.isActive) return [];
  if (isLeadershipUser(actor)) return workLogs;

  const tier = getUserScopeTier(actor);
  if (tier === 'STAFF') {
    return workLogs.filter((w) => w.userId === actor.uid);
  }

  const managedProjectIds = new Set(
    getManagedProjects(actor, projects).map((p) => p.id)
  );
  const visibleTaskIds = new Set(visibleTasks.map((t) => t.id));
  const managedGroupIds = getManagedGroupIds(actor, groups);

  return workLogs.filter((w) => {
    if (w.userId === actor.uid) return true;
    if (w.projectId && managedProjectIds.has(w.projectId)) return true;
    if (visibleTaskIds.has(w.taskId)) return true;
    if (managedGroupIds.size > 0 && w.viewerIds.includes(actor.uid)) return true;
    return false;
  });
}

export function getVisibleAuditLogs(
  actor: UserProfile | null | undefined,
  auditLogs: SystemAuditLog[],
  visibleTasks: TaskItem[],
  projects: Project[]
): SystemAuditLog[] {
  if (!actor || !actor.isActive) return [];
  if (isLeadershipUser(actor)) return auditLogs;

  const managedProjectIds = new Set(
    getManagedProjects(actor, projects).map((p) => p.id)
  );
  const visibleTaskIds = new Set(visibleTasks.map((t) => t.id));

  return auditLogs.filter(
    (a) =>
      a.actorId === actor.uid ||
      managedProjectIds.has(a.targetId) ||
      visibleTaskIds.has(a.targetId)
  );
}

export function buildParticipantIds(params: {
  creatorId: string;
  assigneeId: string;
  reviewerId: string;
  groupId: string;
  project?: Project | null;
  allUsers: UserProfile[];
}): string[] {
  const ids = new Set<string>([params.creatorId, params.assigneeId, params.reviewerId]);

  for (const u of params.allUsers) {
    if (
      u.roles.includes('ADMIN') ||
      u.roles.includes('TRUONG_PHONG') ||
      u.roles.includes('PHO_PHONG')
    ) {
      ids.add(u.uid);
    }
    if (params.groupId && u.groupId === params.groupId && u.roles.includes('TRUONG_NHOM')) {
      ids.add(u.uid);
    }
  }

  if (params.project?.pmId) {
    ids.add(params.project.pmId);
  }

  return Array.from(ids).slice(0, 50);
}
