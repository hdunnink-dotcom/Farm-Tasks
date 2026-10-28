import { useState } from 'react';
import { useGetFarmMonthlySummary, getGetFarmMonthlySummaryQueryKey } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, BarChart3, CheckCircle2, AlertCircle, Clock, User, MapPin, Tag, Calendar, HelpCircle } from 'lucide-react';
import { ErrorState, TaskSkeleton, StatCard } from './farm-planner';

const getMonthString = (date: Date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export function MonthlyOverview({ accountScope }: { accountScope: string | null }) {
  const [month, setMonth] = useState(() => getMonthString(new Date()));

  const query = useGetFarmMonthlySummary(
    { month },
    {
      query: {
        queryKey: [...getGetFarmMonthlySummaryQueryKey({ month }), accountScope],
        enabled: Boolean(accountScope),
      },
    }
  );

  const handlePrev = () => {
    const [y, m] = month.split('-').map(Number);
    setMonth(getMonthString(new Date(y, m - 2, 1)));
  };

  const handleNext = () => {
    const [y, m] = month.split('-').map(Number);
    setMonth(getMonthString(new Date(y, m, 1)));
  };

  const [y, m] = month.split('-').map(Number);
  const formattedMonth = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(y, m - 1, 1)
  );

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden" data-testid="panel-monthly-overview">
      <div className="flex flex-wrap items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-5 py-4 md:px-7">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-[13px] border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]">
            <BarChart3 size={20} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="font-serif text-2xl text-[hsl(var(--foreground))]">Monthly Overview</h2>
            <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">Track completion rates and team progress.</p>
          </div>
        </div>
        <div className="mt-4 flex w-full items-center justify-between md:mt-0 md:w-auto md:justify-end gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-1">
          <button type="button" onClick={handlePrev} aria-label="Previous month" data-testid="button-prev-month" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div className="w-[140px] text-center font-mono text-sm font-semibold uppercase tracking-[.1em] text-[hsl(var(--foreground))]" aria-live="polite">
            {formattedMonth}
          </div>
          <button type="button" onClick={handleNext} aria-label="Next month" data-testid="button-next-month" className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="p-5 md:p-7">
        {query.isLoading ? (
          <TaskSkeleton count={3} />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} message="Could not load monthly summary." />
        ) : query.data ? (
          <div className="space-y-8">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Scheduled" value={query.data.scheduled} detail="Total tasks this month" icon={Calendar} />
              <StatCard label="Completed" value={query.data.completed} detail={`${Math.round(query.data.completionRate * 100)}% completion rate`} icon={CheckCircle2} />
              <StatCard label="Outstanding" value={query.data.outstanding} detail="Tasks remaining" icon={Clock} />
              <StatCard label="Overdue" value={query.data.overdue} detail="Past scheduled date" icon={AlertCircle} accent={query.data.overdue > 0} />
            </div>

            {query.data.completionDateUnknown > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-[hsl(35_62%_56%/.3)] bg-[hsl(35_82%_66%/.1)] px-4 py-3 text-sm text-[hsl(26_55%_35%)]" role="note">
                <HelpCircle size={18} className="shrink-0 text-[hsl(35_62%_56%)]" />
                <p>
                  <strong>Note:</strong> {query.data.completionDateUnknown} task{query.data.completionDateUnknown === 1 ? ' was' : 's were'} completed without a known date and {query.data.completionDateUnknown === 1 ? 'is' : 'are'} omitted from the chronological totals.
                </p>
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-3">
              <BreakdownList title="By Crew Member" icon={User} items={query.data.workers.map(w => ({ id: w.workerId, label: w.workerName || 'Unknown', value: w.completed }))} />
              <BreakdownList title="By Group" icon={Tag} items={query.data.groups.map(g => ({ id: g.name, label: g.name || 'General', value: g.completed }))} />
              <BreakdownList title="By Location" icon={MapPin} items={query.data.locations.map(l => ({ id: l.name, label: l.name || 'Field', value: l.completed }))} />
            </div>

            <div>
              <h3 className="mb-4 font-serif text-xl text-[hsl(var(--foreground))]">Recent Completions</h3>
              <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
                <div className="grid grid-cols-[minmax(0,1fr)_120px_100px_120px] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-4 py-3 font-mono text-[10px] uppercase tracking-[.15em] font-semibold text-[hsl(var(--muted-foreground))] max-sm:hidden">
                  <div>Task</div>
                  <div>Completed By</div>
                  <div>Group</div>
                  <div>Date</div>
                </div>
                <div className="divide-y divide-[hsl(var(--border))]">
                  {query.data.completions.length === 0 ? (
                    <p className="p-5 text-sm text-[hsl(var(--muted-foreground))]">No tasks completed this month.</p>
                  ) : (
                    query.data.completions.map(c => (
                      <div key={c.taskId + c.completedAt} className="grid sm:grid-cols-[minmax(0,1fr)_120px_100px_120px] gap-2 sm:gap-4 p-4 text-sm hover:bg-[hsl(var(--muted)/.2)] transition-colors">
                        <div className="min-w-0 pr-2">
                          <div className="font-semibold text-[hsl(var(--foreground))] truncate">{c.taskTitle}</div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] sm:hidden">
                            <span>{c.completedByName || 'Unknown'}</span> &middot; <span>{c.group || 'General'}</span>
                          </div>
                        </div>
                        <div className="hidden sm:flex items-center text-[hsl(var(--muted-foreground))] truncate pr-2">{c.completedByName || 'Unknown'}</div>
                        <div className="hidden sm:flex items-center">
                          <span className="rounded-md bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-medium truncate max-w-full">{c.group || 'General'}</span>
                        </div>
                        <div className="flex items-center text-[hsl(var(--muted-foreground))] text-xs font-medium whitespace-nowrap">
                          {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(c.completedAt))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BreakdownList({ title, icon: Icon, items }: { title: string; icon: React.ElementType; items: { id: string; label: string; value: number }[] }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-4 py-3">
        <h3 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.15em] font-semibold text-[hsl(var(--muted-foreground))]">
          <Icon size={13} /> {title}
        </h3>
      </div>
      <div className="divide-y divide-[hsl(var(--border))]">
        {items.length === 0 ? (
          <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">No data.</p>
        ) : (
          items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-4 hover:bg-[hsl(var(--muted)/.2)] transition-colors">
              <span className="text-sm font-medium text-[hsl(var(--foreground))] truncate pr-2">{item.label}</span>
              <span className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 font-mono text-[11px] font-semibold text-[hsl(var(--foreground))] whitespace-nowrap">
                {item.value} done
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
