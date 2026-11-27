import { useId } from 'react';
import { Calendar, X } from 'lucide-react';
import {
  getDateRangePresets,
  TASK_DATE_MODE_LABELS,
  TaskDateFilterMode,
} from '../lib/time';

interface DateRangeFilterBarProps {
  fromDate: string;
  toDate: string;
  dateMode: TaskDateFilterMode;
  onFromDateChange: (val: string) => void;
  onToDateChange: (val: string) => void;
  onDateModeChange: (val: TaskDateFilterMode) => void;
  onReset: () => void;
  showPresets?: boolean;
  includeLast30Days?: boolean;
}

export function DateRangeFilterBar({
  fromDate,
  toDate,
  dateMode,
  onFromDateChange,
  onToDateChange,
  onDateModeChange,
  onReset,
  showPresets = true,
  includeLast30Days = false,
}: DateRangeFilterBarProps) {
  const fromId = useId();
  const toId = useId();
  const presets = getDateRangePresets();
  const hasRange = Boolean(fromDate || toDate);

  const isToday = fromDate === presets.today.from && toDate === presets.today.to;
  const isThisWeek =
    fromDate === presets.thisWeek.from && toDate === presets.thisWeek.to;
  const isThisMonth =
    fromDate === presets.thisMonth.from && toDate === presets.thisMonth.to;
  const isLast30 =
    fromDate === presets.last30Days.from && toDate === presets.last30Days.to;

  return (
    <div className="flex flex-wrap items-center gap-2.5 text-xs">
      <div className="inline-flex items-center gap-1.5 text-slate-500 whitespace-nowrap shrink-0">
        <Calendar className="w-3.5 h-3.5 text-slate-400" />
        <span>Lọc ngày:</span>
      </div>

      <select
        aria-label="Tiêu chí lọc ngày"
        value={dateMode}
        onChange={(e) => onDateModeChange(e.target.value as TaskDateFilterMode)}
        className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
      >
        {(Object.keys(TASK_DATE_MODE_LABELS) as TaskDateFilterMode[]).map((mode) => (
          <option key={mode} value={mode}>
            {TASK_DATE_MODE_LABELS[mode]}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1.5">
        <label className="text-slate-500 whitespace-nowrap" htmlFor={fromId}>
          Từ
        </label>
        <input
          id={fromId}
          aria-label="Từ ngày"
          type="date"
          value={fromDate}
          onChange={(e) => onFromDateChange(e.target.value)}
          className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-blue-700"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <label className="text-slate-500 whitespace-nowrap" htmlFor={toId}>
          Đến
        </label>
        <input
          id={toId}
          aria-label="Đến ngày"
          type="date"
          value={toDate}
          onChange={(e) => onToDateChange(e.target.value)}
          className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-blue-700"
        />
      </div>

      {showPresets && (
        <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              onFromDateChange(presets.today.from);
              onToDateChange(presets.today.to);
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              isToday
                ? 'bg-white text-blue-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={() => {
              onFromDateChange(presets.thisWeek.from);
              onToDateChange(presets.thisWeek.to);
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              isThisWeek
                ? 'bg-white text-blue-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tuần này
          </button>
          <button
            type="button"
            onClick={() => {
              onFromDateChange(presets.thisMonth.from);
              onToDateChange(presets.thisMonth.to);
            }}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              isThisMonth
                ? 'bg-white text-blue-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tháng này
          </button>
          {includeLast30Days && (
            <button
              type="button"
              onClick={() => {
                onFromDateChange(presets.last30Days.from);
                onToDateChange(presets.last30Days.to);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                isLast30
                  ? 'bg-white text-blue-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              30 ngày
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              !hasRange
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tất cả
          </button>
        </div>
      )}

      {!showPresets && hasRange && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-md whitespace-nowrap shrink-0"
        >
          <X className="w-3 h-3" />
          Xóa lọc ngày
        </button>
      )}
    </div>
  );
}
