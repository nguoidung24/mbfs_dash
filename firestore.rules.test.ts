/**
 * Security Rule Verification Suite (Dirty Dozen Adversarial Payloads)
 * Maps each attack vector in security_spec.md to its rule enforcement invariant.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
  enforcedByRule: string;
}

export const dirtyDozenSecurityCases: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Self-Privilege Escalation on users',
    collection: 'users/usr_specialist_1',
    operation: 'create',
    payload: { uid: 'usr_specialist_1', roles: ['ADMIN'], isActive: true, departmentId: 'DAMA2' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'users create requires isAdmin() || isBootstrappedAdmin()',
  },
  {
    id: 2,
    name: 'Shadow Field Injection on tasks',
    collection: 'tasks/tsk_1',
    operation: 'create',
    payload: { id: 'tsk_1', title: 'Test', ghostAdminOverride: true },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidTask() enforces data.keys().hasOnly(...)',
  },
  {
    id: 3,
    name: 'Unverified Email Spoofing',
    collection: 'tasks/tsk_1',
    operation: 'create',
    payload: { email_verified: false, email: 'dungtamtithoi24@gmail.com' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isVerified() mandates request.auth.token.email_verified == true',
  },
  {
    id: 4,
    name: 'PII Blanket Read',
    collection: 'users/usr_other/private/info',
    operation: 'get',
    payload: { requester: 'usr_specialist_1' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'private/info allow get restricted to owner or isLeadership()',
  },
  {
    id: 5,
    name: 'Specialist Self-Approval',
    collection: 'tasks/tsk_1',
    operation: 'update',
    payload: { status: 'HOAN_THANH', reviewResult: 'DA_HOAN_THANH', isLocked: true },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'assigneeWorkProgress restricts status to MOI/DANG_THUC_HIEN/CHO_XAC_NHAN/TAM_HOAN',
  },
  {
    id: 6,
    name: 'Editing Locked Completed Task',
    collection: 'tasks/tsk_completed',
    operation: 'update',
    payload: { title: 'Tampered title' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'editTaskDetails requires existing().isLocked == false',
  },
  {
    id: 7,
    name: 'Future WorkLog Fraud',
    collection: 'workLogs/wl_future',
    operation: 'create',
    payload: { workDate: '2099-01-01', workDateNum: 20990101, hours: 8 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isWorkLogDateEditable() enforces workDateNum <= vnTodayNum()',
  },
  {
    id: 8,
    name: 'Past Locked WorkLog Tampering',
    collection: 'workLogs/wl_past',
    operation: 'create',
    payload: { workDate: '2026-01-01', workDateNum: 20260101, hours: 8 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isWorkLogDateEditable() requires workDateNum == vnTodayNum() || hasWorkLogUnlock()',
  },
  {
    id: 9,
    name: 'Unauthorized WorkLog Unlock',
    collection: 'workLogUnlocks/usr_specialist_1_2026-01-01',
    operation: 'create',
    payload: { userId: 'usr_specialist_1', workDate: '2026-01-01', reason: 'Self unlock' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'workLogUnlocks allow create, update requires isLeadership()',
  },
  {
    id: 10,
    name: 'Path Variable Poisoning',
    collection: 'tasks/' + 'a'.repeat(500),
    operation: 'create',
    payload: { id: 'a'.repeat(500) },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidId() enforces <= 128 chars and ^[a-zA-Z0-9_\\-]+$',
  },
  {
    id: 11,
    name: 'Client Timestamp Spoofing',
    collection: 'workLogs/wl_spoof',
    operation: 'create',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'incoming().createdAt == request.time',
  },
  {
    id: 12,
    name: 'Blanket Query Scraping',
    collection: 'workLogs',
    operation: 'list',
    payload: { queryWithoutUserFilter: true },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'allow list enforces resource.data.userId == request.auth.uid || request.auth.uid in resource.data.viewerIds',
  },
];
