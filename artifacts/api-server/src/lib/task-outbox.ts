import { logger } from "./logger";
import { claimSheetOutboxBatch, finishSheetOutbox } from "./task-repository";
import {
  appendCompletionRecordSheetBacking, createSheetTaskSheetBacking, deleteSheetTaskSheetBacking,
  updateSheetTaskSheetBacking, type CompletionRecord, type SheetTask,
} from "./farm-sheet";

let running = false;
export async function processTaskOutbox(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Claim immediately before each external write. This keeps a slow Google
    // retry from consuming the lease time of later rows in a prefetched batch.
    for (let processed = 0; processed < 25; processed += 1) {
      const claimed = await claimSheetOutboxBatch(1);
      const row = claimed.rows[0];
      if (!row) break;
      try {
        const payload = row.payload as Record<string, unknown>;
        if (row.operation === "upsert") {
          const task = payload as unknown as SheetTask;
          const existing = await (async () => {
            try { return await import("./farm-sheet").then((m) => m.findSheetTaskSheetBacking(task.id)); } catch { return undefined; }
          })();
          if (existing) await updateSheetTaskSheetBacking(task.id, task);
          else await createSheetTaskSheetBacking(task);
        } else if (row.operation === "delete") await deleteSheetTaskSheetBacking(String(payload.id));
        else if (row.operation === "completion") await appendCompletionRecordSheetBacking(payload as unknown as CompletionRecord);
        else throw new Error(`Unsupported Sheet task outbox operation: ${row.operation}`);
        await finishSheetOutbox(row.id, claimed.owner);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error, outboxId: row.id, attempts: row.attempts }, "Sheet task outbox export failed; will retry");
        await finishSheetOutbox(row.id, claimed.owner, message);
      }
    }
  } finally { running = false; }
}
export function startTaskOutboxProcessor(): void {
  const tick = () => void processTaskOutbox().catch((error) => logger.warn({ err: error }, "Sheet outbox processor failed"));
  tick();
  setInterval(tick, 5_000).unref();
}