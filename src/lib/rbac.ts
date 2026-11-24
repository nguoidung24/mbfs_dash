import { Project, RoleCode, TaskItem, UserProfile } from '../types/domain';

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

export function canUnlockWorkLog(user: UserProfile | null | undefined): boolean {
  return isLeadershipUser(user);
}

/**
 * Principle: Cannot assign upwards.
 * - Admin / Trưởng phòng / Phó phòng: assign to any subordinate (rank strictly lower or any non-higher).
 * - Quản lý dự án: assign to members of projects they manage.
 * - Trưởng nhóm: assign to members of their group.
 * - Chuyên viên: cannot assign to others (only self-create).
 */
export function getAssignableUsers(
  actor: UserProfile,
  allUsers: UserProfile[],
  selectedProject?: Project | null
): UserProfile[] {
  const activeUsers = allUsers.filter((u) => u.isActive);
  if (isAdminUser(actor) || hasRole(actor, 'TRUONG_PHONG')) {
    return activeUsers;
  }
  if (hasRole(actor, 'PHO_PHONG')) {
    return activeUsers.filter((u) => !u.roles.includes('TRUONG_PHONG'));
  }

  const allowedSet = new Map<string, UserProfile>();
  // Self is always allowed
  allowedSet.set(actor.uid, actor);

  // If actor is PM of selectedProject, can assign to project members (not above actor rank)
  if (selectedProject && selectedProject.pmId === actor.uid) {
    for (const u of activeUsers) {
      if (
        selectedProject.memberIds.includes(u.uid) &&
        !u.roles.includes('TRUONG_PHONG') &&
        !u.roles.includes('PHO_PHONG')
      ) {
        allowedSet.set(u.uid, u);
      }
    }
  }

  // If actor is Trưởng nhóm, can assign to members of their group (Chuyên viên / same or lower)
  if (hasRole(actor, 'TRUONG_NHOM') && actor.groupId) {
    for (const u of activeUsers) {
      if (
        u.groupId === actor.groupId &&
        !u.roles.includes('TRUONG_PHONG') &&
        !u.roles.includes('PHO_PHONG')
      ) {
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
  projects: Project[]
): boolean {
  if (!actor || !actor.isActive) return false;
  if (isLeadershipUser(actor)) return true;
  if (task.reviewerId === actor.uid) return true;
  const project = task.projectId ? projects.find((p) => p.id === task.projectId) : undefined;
  if (project && project.pmId === actor.uid) return true;
  if (hasRole(actor, 'TRUONG_NHOM') && actor.groupId === task.groupId) return true;
  return false;
}

export function canEditTaskMetadata(
  actor: UserProfile | null | undefined,
  task: TaskItem,
  projects: Project[]
): boolean {
  if (!actor || !actor.isActive) return false;
  if (task.isLocked && !isAdminUser(actor)) return false;
  if (isLeadershipUser(actor)) return true;
  if (task.creatorId === actor.uid) return true;
  return canReviewTask(actor, task, projects);
}

export function canCancelTask(
  actor: UserProfile | null | undefined,
  task: TaskItem,
  projects: Project[]
): boolean {
  if (!actor || !actor.isActive) return false;
  if (task.isLocked) return false;
  if (isLeadershipUser(actor)) return true;
  if (task.creatorId === actor.uid && task.assigneeId !== actor.uid) return true;
  return canReviewTask(actor, task, projects);
}

export function getVisibleTasks(
  actor: UserProfile | null | undefined,
  tasks: TaskItem[],
  projects: Project[]
): TaskItem[] {
  if (!actor || !actor.isActive) return [];
  if (isLeadershipUser(actor)) return tasks;

  const managedProjectIds = new Set(
    projects.filter((p) => p.pmId === actor.uid || p.memberIds.includes(actor.uid)).map((p) => p.id)
  );

  return tasks.filter((t) => {
    if (
      t.creatorId === actor.uid ||
      t.assigneeId === actor.uid ||
      t.reviewerId === actor.uid ||
      t.participantIds.includes(actor.uid)
    ) {
      return true;
    }
    if (t.projectId && managedProjectIds.has(t.projectId)) {
      return true;
    }
    if (hasRole(actor, 'TRUONG_NHOM') && actor.groupId && t.groupId === actor.groupId) {
      return true;
    }
    return false;
  });
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

  if (params.project) {
    ids.add(params.project.pmId);
    for (const m of params.project.memberIds) {
      if (ids.size < 50) ids.add(m);
    }
  }

  return Array.from(ids).slice(0, 50);
}
