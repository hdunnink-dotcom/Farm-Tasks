export function resolveDefaultLocation(locations: string[], requested: string): string {
  const value = requested.trim();
  if (!value) return '';
  return locations.includes(value) ? value : locations[0] ?? '';
}