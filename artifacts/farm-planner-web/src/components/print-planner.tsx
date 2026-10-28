import { useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Printer, X } from 'lucide-react';
import type { FarmTask } from '@workspace/api-client-react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  monthPrintGroups,
  printPeriodLabel,
  shiftMonth,
  shiftWeek,
  startOfWeek,
  toDateInputValue,
  toMonthInputValue,
  type PrintPeriod,
  weekPrintGroups,
} from '@/lib/task-print';
import { trackEvent } from '@/lib/analytics';

export function PrintPlanner({ tasks }: { tasks: FarmTask[] }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<PrintPeriod>('week');
  const [selected, setSelected] = useState(() => new Date());
  const groups = useMemo(
    () => period === 'week' ? weekPrintGroups(tasks, selected) : monthPrintGroups(tasks, selected),
    [period, selected, tasks],
  );
  const taskCount = groups.reduce((total, group) => total + group.tasks.length, 0);

  const move = (amount: number) => {
    setSelected((current) => period === 'week' ? shiftWeek(current, amount) : shiftMonth(current, amount));
  };
  const printTasks = () => {
    trackEvent('tasks_printed', { period, task_count: taskCount });
    window.print();
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" data-testid="button-open-print-planner" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]">
          <Printer size={16} /> Print
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop fixed inset-0 z-50" />
        <Dialog.Content className="fixed bottom-0 left-1/2 z-50 w-full -translate-x-1/2 rounded-t-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-2xl md:bottom-auto md:top-1/2 md:max-w-lg md:-translate-y-1/2 md:rounded-[1.5rem] md:p-6">
            <div className="flex items-center justify-between">
              <div><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Paper checklist</p><Dialog.Title className="mt-1 font-serif text-2xl">Print tasks</Dialog.Title></div>
              <Dialog.Close asChild><button type="button" aria-label="Close print options" className="rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"><X size={18} /></button></Dialog.Close>
            </div>
            <div className="mt-5 grid grid-cols-2 rounded-xl bg-[hsl(var(--muted))] p-1">
              {(['week', 'month'] as const).map((option) => <button key={option} type="button" onClick={() => setPeriod(option)} aria-pressed={period === option} data-testid={`button-print-${option}`} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${period === option ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>{option}</button>)}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button type="button" onClick={() => move(-1)} aria-label={`Previous ${period}`} className="rounded-lg border border-[hsl(var(--border))] p-2.5 hover:bg-[hsl(var(--muted))]"><ChevronLeft size={17} /></button>
              <label className="relative min-w-0 flex-1">
                <CalendarRange size={15} className="pointer-events-none absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" />
                {period === 'week'
                  ? <input type="date" aria-label="Week beginning" value={toDateInputValue(startOfWeek(selected))} onChange={(event) => setSelected(new Date(`${event.target.value}T12:00:00`))} data-testid="input-print-week" className="field-input pl-9" />
                  : <input type="month" aria-label="Month to print" value={toMonthInputValue(selected)} onChange={(event) => setSelected(new Date(`${event.target.value}-01T12:00:00`))} data-testid="input-print-month" className="field-input pl-9" />}
              </label>
              <button type="button" onClick={() => move(1)} aria-label={`Next ${period}`} className="rounded-lg border border-[hsl(var(--border))] p-2.5 hover:bg-[hsl(var(--muted))]"><ChevronRight size={17} /></button>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border))] pt-5">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{taskCount} open task{taskCount === 1 ? '' : 's'}</p>
              <button type="button" onClick={printTasks} disabled={taskCount === 0} data-testid="button-print-now" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-40"><Printer size={16} /> Print</button>
            </div>
        </Dialog.Content>
        <PrintSheet period={period} selected={selected} groups={groups} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PrintSheet({ period, selected, groups }: { period: PrintPeriod; selected: Date; groups: ReturnType<typeof weekPrintGroups> }) {
  return (
    <article className={`print-planner-sheet print-planner-${period}`} aria-hidden="true">
      <header>
        <p>Fieldbook · {period === 'week' ? 'Weekly' : 'Monthly'} checklist</p>
        <h1>{printPeriodLabel(period, selected)}</h1>
      </header>
      <main>
        {groups.map((group) => (
          <section key={group.key} className="print-task-group">
            <div className="print-group-heading"><h2>{group.label}</h2><span>{group.tasks.length || '—'}</span></div>
            {group.tasks.length === 0 ? <div className="print-empty-line" /> : group.tasks.map((task) => (
              <div key={task.id} className="print-task-row">
                <span className="print-checkbox" />
                <div>
                  <h3>{task.task}</h3>
                  <p>{[
                    task.group || 'General',
                    task.urgency,
                    task.location || '',
                    task.assigneeName ? `Assigned to ${task.assigneeName}` : '',
                  ].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            ))}
          </section>
        ))}
      </main>
      <footer>Printed {new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}</footer>
    </article>
  );
}