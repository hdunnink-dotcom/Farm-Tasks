import type { FarmTask } from '@workspace/api-client-react';

export function createScopeSerializer() {
  const tails = new Map<string, Promise<void>>();
  return async function serialize<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(scope) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = () => resolve(); });
    const tail = previous.catch(() => undefined).then(() => gate);
    tails.set(scope, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(scope) === tail) tails.delete(scope);
    }
  };
}

export function reconcileServerTasks(
  serverTasks: FarmTask[],
  localTasks: FarmTask[],
  pendingTaskIds: ReadonlySet<string>,
): FarmTask[] {
  const serverIds = new Set(serverTasks.map((task) => task.id));
  const merged = serverTasks.map((task) =>
    pendingTaskIds.has(task.id)
      ? localTasks.find((localTask) => localTask.id === task.id) ?? task
      : task,
  );
  for (const localTask of localTasks) {
    if (pendingTaskIds.has(localTask.id) && !serverIds.has(localTask.id)) merged.push(localTask);
  }
  return merged;
}