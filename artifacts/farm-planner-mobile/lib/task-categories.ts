import type { TaskCategory } from '@workspace/api-client-react';

export const TASK_CATEGORIES = [
  'Orchards',
  'Planting',
  'Gullies',
  'Repair',
  'Trapping',
  'Admin',
  'Yurts',
  'Meat',
  'Pommeu',
] as const satisfies readonly TaskCategory[];