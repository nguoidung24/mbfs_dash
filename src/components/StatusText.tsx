import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  Flame,
  Lock,
  PauseCircle,
  Send,
  XCircle,
} from 'lucide-react';
import {
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  ProjectStatus,
  TASK_STATUS_LABELS,
  TaskPriority,
  TaskStatus,
} from '../types/domain';

export function TaskStatusLabel({
  status,
  isOverdue = false,
}: {
  status: TaskStatus;
  isOverdue?: boolean;
}) {
  const colorMap: Record<TaskStatus, string> = {
    MOI: 'text-slate-600',
    DANG_THUC_HIEN: 'text-blue-700',
    CHO_XAC_NHAN: 'text-amber-700',
    CHUA_HOAN_THANH: 'text-red-700',
    HOAN_THANH: 'text-emerald-700',
    TAM_HOAN: 'text-slate-500',
    HUY: 'text-slate-400 line-through',
  };

  const Icon =
    status === 'HOAN_THANH'
      ? CheckCircle2
      : status === 'CHO_XAC_NHAN'
      ? Send
      : status === 'CHUA_HOAN_THANH'
      ? AlertCircle
      : status === 'TAM_HOAN'
      ? PauseCircle
      : status === 'HUY'
      ? XCircle
      : Clock;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${colorMap[status]}`} />
      <span className={colorMap[status]}>{TASK_STATUS_LABELS[status]}</span>
      {isOverdue && (
        <>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="text-red-600 font-semibold">Quá hạn</span>
        </>
      )}
    </span>
  );
}

export function PriorityLabel({ priority }: { priority: TaskPriority }) {
  const styles: Record<TaskPriority, string> = {
    THAP: 'text-slate-500',
    TRUNG_BINH: 'text-slate-700',
    CAO: 'text-amber-700 font-medium',
    KHAN_CAP: 'text-red-700 font-semibold',
  };

  const Icon =
    priority === 'KHAN_CAP'
      ? Flame
      : priority === 'CAO'
      ? ArrowUp
      : priority === 'THAP'
      ? ArrowDown
      : ArrowRight;

  return (
    <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${styles[priority]}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{PRIORITY_LABELS[priority]}</span>
    </span>
  );
}

export function ProjectStatusLabel({ status }: { status: ProjectStatus }) {
  const colorMap: Record<ProjectStatus, string> = {
    CHUAN_BI: 'text-slate-600',
    DANG_THUC_HIEN: 'text-blue-700 font-medium',
    TAM_DUNG: 'text-amber-700',
    HOAN_THANH: 'text-emerald-700 font-medium',
    DONG: 'text-slate-500',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${colorMap[status]}`}>
      {status === 'DONG' && <Lock className="w-3 h-3 shrink-0" />}
      <span>{PROJECT_STATUS_LABELS[status]}</span>
    </span>
  );
}
