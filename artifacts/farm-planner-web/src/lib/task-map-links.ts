import type { FarmTask } from '@workspace/api-client-react';

export const FARM_MAP_START_URL = 'https://maps.app.goo.gl/19arv7SorUiWDcZSA';

export function hasTaskCoordinates(task: Pick<FarmTask, 'latitude' | 'longitude'>): task is Pick<FarmTask, 'latitude' | 'longitude'> & { latitude: number; longitude: number } {
  return typeof task.latitude === 'number'
    && Number.isFinite(task.latitude)
    && typeof task.longitude === 'number'
    && Number.isFinite(task.longitude);
}

export function googleMapsUrl(task: Pick<FarmTask, 'latitude' | 'longitude'>): string | null {
  return hasTaskCoordinates(task)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${task.latitude},${task.longitude}`)}`
    : null;
}

export function googleMapsRouteUrl(tasks: FarmTask[]): string | null {
  const located = tasks.filter(hasTaskCoordinates).slice(0, 10);
  if (!located.length) return null;
  if (located.length === 1) return googleMapsUrl(located[0]);
  const point = (task: FarmTask) => `${task.latitude},${task.longitude}`;
  const [origin, ...rest] = located;
  const destination = rest.at(-1)!;
  const waypoints = rest.slice(0, -1);
  const parameters = new URLSearchParams({ api: '1', origin: point(origin), destination: point(destination) });
  if (waypoints.length) parameters.set('waypoints', waypoints.map(point).join('|'));
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}

export function isSafeExternalUrl(value?: string | null): value is string {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}