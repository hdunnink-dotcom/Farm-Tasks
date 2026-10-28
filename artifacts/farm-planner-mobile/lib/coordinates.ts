export type CoordinatePair = { latitude: number | null; longitude: number | null };

const DMS_PAIR = /^\s*(\d{1,3})°\s*(\d{1,2})['’]\s*(\d+(?:\.\d+)?)["”]\s*([NS])\s+(\d{1,3})°\s*(\d{1,2})['’]\s*(\d+(?:\.\d+)?)["”]\s*([EW])\s*$/i;

function decimal(degrees: string, minutes: string, seconds: string, hemisphere: string, maxDegrees: number) {
  const d = Number(degrees);
  const m = Number(minutes);
  const s = Number(seconds);
  if (m >= 60 || s >= 60 || d > maxDegrees || (d === maxDegrees && (m > 0 || s > 0))) return null;
  const value = d + m / 60 + s / 3600;
  return 'SW'.includes(hemisphere.toUpperCase()) ? -value : value;
}

export function parseCoordinatePair(value: string): CoordinatePair | null {
  if (!value.trim()) return { latitude: null, longitude: null };
  const match = value.match(DMS_PAIR);
  if (!match) return null;
  const latitude = decimal(match[1], match[2], match[3], match[4], 90);
  const longitude = decimal(match[5], match[6], match[7], match[8], 180);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function formatCoordinate(value: number, positive: string, negative: string) {
  const hemisphere = value < 0 ? negative : positive;
  let totalSeconds = Math.round(Math.abs(value) * 3600 * 100) / 100;
  let degrees = Math.floor(totalSeconds / 3600);
  totalSeconds -= degrees * 3600;
  let minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds - minutes * 60;
  if (seconds >= 60) { seconds = 0; minutes += 1; }
  if (minutes >= 60) { minutes = 0; degrees += 1; }
  return `${degrees}°${minutes}'${seconds.toFixed(2).padStart(5, '0')}"${hemisphere}`;
}

export function formatCoordinatePair(latitude?: number | null, longitude?: number | null) {
  return typeof latitude === 'number' && typeof longitude === 'number'
    ? `${formatCoordinate(latitude, 'N', 'S')} ${formatCoordinate(longitude, 'E', 'W')}`
    : '';
}