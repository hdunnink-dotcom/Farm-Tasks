import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  calendarMonthDays,
  calendarMonthLabel,
  calendarStartDayKey,
  formatAucklandDateTimeInput,
  localAucklandDateKey,
  parseAucklandDateTimeInput,
  shiftLocalMonth,
} from '@/lib/task-calendar';

type ScheduledDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
};

function localTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const writtenTime = value.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/);
  if (writtenTime && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return `${writtenTime[1]}:${writtenTime[2]}`;
  return formatAucklandDateTimeInput(value).slice(11, 16);
}

export function ScheduledDatePicker({ value, onChange }: ScheduledDatePickerProps) {
  const initialDate = calendarStartDayKey(value) ?? localAucklandDateKey();
  const [selectedDate, setSelectedDate] = useState(calendarStartDayKey(value) ?? '');
  const [time, setTime] = useState(localTime(value));
  const [displayMonth, setDisplayMonth] = useState(initialDate.slice(0, 7));

  useEffect(() => {
    const nextDate = calendarStartDayKey(value) ?? '';
    setSelectedDate(nextDate);
    setTime(localTime(value));
    if (nextDate) setDisplayMonth(nextDate.slice(0, 7));
  }, [value]);

  const days = useMemo(() => calendarMonthDays(displayMonth), [displayMonth]);
  const hasSchedule = Boolean(value || selectedDate || time);
  const chooseDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    const next = time ? `${dateKey}T${time}` : dateKey;
    onChange(time ? (parseAucklandDateTimeInput(next) ?? next) : next);
  };
  const changeTime = (nextTime: string) => {
    setTime(nextTime);
    if (!selectedDate) return;
    const next = nextTime ? `${selectedDate}T${nextTime}` : selectedDate;
    onChange(nextTime ? (parseAucklandDateTimeInput(next) ?? next) : next);
  };
  const clear = () => {
    setSelectedDate('');
    setTime('');
    setDisplayMonth(localAucklandDateKey().slice(0, 7));
    onChange('');
  };

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.28)] p-3" data-testid="task-schedule-picker">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setDisplayMonth((month) => shiftLocalMonth(month, -1))} aria-label="Previous calendar month" data-testid="button-calendar-previous-month" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
          <ChevronLeft size={16} />
        </button>
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--foreground))]" data-testid="text-calendar-month">
          <CalendarDays size={15} className="text-[hsl(var(--primary))]" />{calendarMonthLabel(displayMonth)}
        </p>
        <button type="button" onClick={() => setDisplayMonth((month) => shiftLocalMonth(month, 1))} aria-label="Next calendar month" data-testid="button-calendar-next-month" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`} className="py-1 font-mono text-[10px] font-semibold uppercase text-[hsl(var(--muted-foreground))]">{day}</span>)}
        {days.map((dateKey) => {
          const isCurrentMonth = dateKey.slice(0, 7) === displayMonth;
          const isSelected = dateKey === selectedDate;
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => chooseDate(dateKey)}
              aria-label={`Choose ${dateKey}`}
              aria-pressed={isSelected}
              data-testid={`calendar-date-${dateKey}`}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors ${isSelected ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : isCurrentMonth ? 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]' : 'text-[hsl(var(--muted-foreground)/.45)] hover:bg-[hsl(var(--muted))]'}`}
            >
              {Number(dateKey.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-[hsl(var(--border))] pt-3">
        <label className="min-w-[130px] flex-1 text-xs font-semibold text-[hsl(var(--foreground))]">
          Time in Auckland
          <input type="time" value={time} onChange={(event) => changeTime(event.target.value)} data-testid="input-task-calendar-time" className="field-input mt-1.5 w-full" />
        </label>
        {hasSchedule && <button type="button" onClick={clear} data-testid="button-clear-task-calendar" className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-3 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={14} /> Clear</button>}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">Choose a date and optional time. Leave it clear for unscheduled work.</p>
    </div>
  );
}