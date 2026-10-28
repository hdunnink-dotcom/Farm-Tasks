export const DEFAULT_FARM_GROUPS = [
  'Orchards',
  'Planting',
  'Gullies',
  'Repair',
  'Trapping',
  'Admin',
  'Yurts',
  'Meat',
  'Pommeu',
];

export function resolveDefaultLocation(locations: string[], requested: string): string {
  const value = requested.trim();
  if (!value) return '';
  return locations.includes(value) ? value : locations[0] ?? '';
}