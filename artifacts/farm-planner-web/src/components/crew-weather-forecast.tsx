import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cloud, CloudRain, RefreshCw, Wind, X } from 'lucide-react';

export type CrewWeatherHour = {
  time: string;
  localHour: number;
  temperatureC: number | null;
  rainMm: number;
  windKmh: number | null;
  windDirectionDegrees: number | null;
  windDirection: string | null;
  cloudCoverPercent: number | null;
  condition: string;
};

export type CrewWeatherDay = {
  date: string;
  partial: boolean;
  totalRainMm: number;
  maxWindKmh: number | null;
  averageCloudCoverPercent: number | null;
  condition: string;
  hours: CrewWeatherHour[];
};

export type CrewWeatherResponse = {
  location: { name: string; latitude: number; longitude: number };
  source: string;
  sourceUrl: string;
  updatedAt: string;
  stale: boolean;
  days: CrewWeatherDay[];
};

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dayLabel(dateKey: string): { weekday: string; date: string } {
  const date = dateFromKey(dateKey);
  return {
    weekday: new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', weekday: 'short' }).format(date),
    date: new Intl.DateTimeFormat('en-NZ', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(date),
  };
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12 am';
  if (hour === 12) return '12 pm';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

function updatedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Update time unavailable';
  return `Updated ${new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(date)}`;
}

function WeatherLoading() {
  return (
    <div className="min-w-0 flex-1" aria-label="Loading 10-day weather forecast" data-testid="crew-weather-loading">
      <div className="mb-2 h-3 w-48 animate-pulse rounded bg-[hsl(var(--muted))]" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-[86px] min-w-[88px] animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
        ))}
      </div>
    </div>
  );
}

function WeatherUnavailable({ message, onRefresh, refreshing }: { message: string; onRefresh: () => void; refreshing: boolean }) {
  return (
    <section className="min-w-[280px] flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.82)] px-4 py-3" aria-label="Weather forecast unavailable" data-testid="crew-weather-unavailable">
      <div className="flex items-start gap-3">
        <CloudRain size={19} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[hsl(var(--foreground))]">Ngātīmoti weather unavailable</p>
          <p className="mt-1 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">{message}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] disabled:opacity-50"
          aria-label="Retry weather forecast"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    </section>
  );
}

export function CrewWeatherPanel({
  forecast,
  loading = false,
  error,
  refreshing = false,
  onRefresh,
}: {
  forecast?: CrewWeatherResponse;
  loading?: boolean;
  error?: string;
  refreshing?: boolean;
  onRefresh: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState<CrewWeatherDay>();
  if (loading) return <WeatherLoading />;
  if (!forecast) {
    return <WeatherUnavailable message={error || 'The forecast provider did not return data. Crew planning is still available.'} onRefresh={onRefresh} refreshing={refreshing} />;
  }

  return (
    <section className="min-w-0 flex-1" aria-labelledby="crew-weather-title" data-testid="crew-weather-panel">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
        <Cloud size={13} className="text-[hsl(var(--primary))]" />
        <h2 id="crew-weather-title" className="font-bold uppercase tracking-[0.12em] text-[hsl(var(--foreground))]">{forecast.location.name}</h2>
        {forecast.stale && <span className="rounded-full bg-[hsl(var(--accent)/.24)] px-2 py-0.5 font-semibold text-[hsl(var(--accent-foreground))]">Saved forecast</span>}
        <span className="truncate">{updatedLabel(forecast.updatedAt)}</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          aria-label="Refresh weather forecast"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="crew-weather-days">
        {forecast.days.map((day) => {
          const label = dayLabel(day.date);
          return (
            <button
              type="button"
              key={day.date}
              onClick={() => setSelectedDay(day)}
              className="min-w-[86px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.42)] hover:shadow-md"
              aria-label={`${label.weekday} ${label.date}: ${day.totalRainMm} millimetres rain${day.partial ? ' remaining from now' : ''}, wind up to ${day.maxWindKmh ?? 0} kilometres per hour, ${day.condition}. Open hourly forecast.`}
              data-testid={`crew-weather-day-${day.date}`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-[hsl(var(--foreground))]">{label.weekday}</span>
                <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{label.date}</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[hsl(var(--primary))]">
                <CloudRain size={13} />
                <span className="font-mono text-sm font-bold">{day.totalRainMm}</span>
                <span className="text-[9px] font-semibold">mm</span>
                {day.partial && <span className="ml-auto text-[8px] font-semibold text-[hsl(var(--muted-foreground))]">from now</span>}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[9px] text-[hsl(var(--muted-foreground))]">
                <Wind size={10} />
                <span>{day.maxWindKmh === null ? '—' : `${day.maxWindKmh} km/h`}</span>
              </div>
              <p className="mt-1 truncate text-[9px] font-medium text-[hsl(var(--muted-foreground))]">{day.condition}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex justify-end">
        <a href={forecast.sourceUrl} target="_blank" rel="noreferrer" className="text-[9px] text-[hsl(var(--muted-foreground))] underline decoration-dotted underline-offset-2">
          {forecast.source}
        </a>
      </div>

      <Dialog.Root open={Boolean(selectedDay)} onOpenChange={(open) => { if (!open) setSelectedDay(undefined); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-backdrop fixed inset-0 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[86vh] w-[92vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl">
            {selectedDay && (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border))] px-6 py-5">
                  <div>
                    <Dialog.Title className="font-serif text-2xl text-[hsl(var(--foreground))]">
                      {dayLabel(selectedDay.date).weekday}, {dayLabel(selectedDay.date).date}
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      Hourly rain, wind and cloud forecast{selectedDay.partial ? ' from now' : ''} for {forecast.location.name}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button type="button" className="flex size-9 items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))]" aria-label="Close hourly forecast">
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                </div>
                <div className="max-h-[65vh] overflow-y-auto p-4 sm:p-6">
                  <div className="grid grid-cols-[72px_minmax(88px,1.2fr)_minmax(100px,1fr)_minmax(112px,1fr)] gap-x-3 border-b border-[hsl(var(--border))] px-3 pb-2 text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    <span>Time</span><span>Rain</span><span>Wind</span><span>Cloud</span>
                  </div>
                  <ol className="divide-y divide-[hsl(var(--border))]" data-testid="crew-weather-hourly-list">
                    {selectedDay.hours.map((hour) => (
                      <li key={hour.time} className="grid min-h-12 grid-cols-[72px_minmax(88px,1.2fr)_minmax(100px,1fr)_minmax(112px,1fr)] items-center gap-x-3 px-3 text-xs">
                        <time dateTime={hour.time} className="font-semibold text-[hsl(var(--foreground))]">{hourLabel(hour.localHour)}</time>
                        <span className={`flex items-center gap-1.5 font-mono font-bold ${hour.rainMm > 0 ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                          <CloudRain size={14} /> {hour.rainMm} mm
                        </span>
                        <span className="flex items-center gap-1.5 text-[hsl(var(--foreground))]">
                          <Wind size={13} className="text-[hsl(var(--muted-foreground))]" />
                          {hour.windKmh === null ? '—' : `${hour.windKmh} km/h`} {hour.windDirection ?? ''}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                          <Cloud size={13} />
                          <span className="truncate">{hour.cloudCoverPercent === null ? hour.condition : `${hour.cloudCoverPercent}% · ${hour.condition}`}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

const WEATHER_QUERY_KEY = ['crew-plan-weather'] as const;

export function CrewWeatherForecast({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: WEATHER_QUERY_KEY,
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: () => customFetch<CrewWeatherResponse>('/api/weather/crew-plan'),
  });
  const refresh = useMutation({
    mutationFn: () => customFetch<CrewWeatherResponse>('/api/weather/crew-plan?refresh=1'),
    onSuccess: (forecast) => queryClient.setQueryData(WEATHER_QUERY_KEY, forecast),
  });
  const error = refresh.error ?? query.error;
  return (
    <CrewWeatherPanel
      forecast={query.data}
      loading={query.isLoading}
      error={error instanceof Error ? error.message : undefined}
      refreshing={refresh.isPending || query.isFetching}
      onRefresh={() => {
        if (query.data) refresh.mutate();
        else void query.refetch();
      }}
    />
  );
}