import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { scanTaskSourcesIfDue } from "../lib/claude-task-planner";
import { runScheduledDailyPlanCheck } from "../lib/daily-plan";
import { logger } from "../lib/logger";
import { syncOrchardCalendar } from "../lib/orchard-calendar";
import { processTaskOutbox } from "../lib/task-outbox";

/**
 * Background work for hosts that scale to zero (Google Cloud Run). Cloud
 * Scheduler calls POST /api/internal/tick every 30 minutes with the shared
 * secret; each job runs inside the request so it gets CPU time.
 */
const router: IRouter = Router();

function authorised(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !header) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function step<T>(name: string, run: () => Promise<T>): Promise<{ ok: boolean; result?: T; error?: string }> {
  try {
    return { ok: true, result: await run() };
  } catch (error) {
    logger.warn({ err: error, job: name }, "Scheduled job failed");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

router.post("/internal/tick", async (req, res) => {
  if (!authorised(req.header("x-farm-cron-secret"))) {
    res.status(401).json({ error: "Unauthorised" });
    return;
  }
  const outbox = await step("sheet-outbox", processTaskOutbox);
  const calendar = await step("calendar-sync", async () => {
    const result = await syncOrchardCalendar();
    return { created: result.created, updated: result.updated, cancelled: result.cancelled, errors: result.errors };
  });
  const planner = await step("claude-scan", () => scanTaskSourcesIfDue());
  const dailyPlan = await step("daily-plan", () => runScheduledDailyPlanCheck());
  const summary = { outbox, calendar, planner, dailyPlan };
  logger.info(summary, "Scheduled tick finished");
  res.json(summary);
});

export default router;
