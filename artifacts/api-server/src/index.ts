import app from "./app";
import { logger } from "./lib/logger";
import { startOrchardCalendarSchedule } from "./lib/orchard-calendar";
import { startClaudeTaskPlannerSchedule } from "./lib/claude-task-planner";
import { startDailyPlanSchedule } from "./lib/daily-plan";
import { startTaskOutboxProcessor } from "./lib/task-outbox";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function runMigrations(): Promise<void> {
  const migrationsFolder = process.env.MIGRATIONS_DIR?.trim();
  if (!migrationsFolder) return;
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { db } = await import("@workspace/db");
  await migrate(db, { migrationsFolder });
  logger.info({ migrationsFolder }, "Database migrations applied");
}

await runMigrations();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // On hosts that scale to zero (Cloud Run) these timers are replaced by
  // Cloud Scheduler calling POST /api/internal/tick, so they can be switched off
  // to avoid a calendar sync and Claude scan on every cold start.
  if (process.env.FARM_IN_PROCESS_SCHEDULERS !== "false") {
    startOrchardCalendarSchedule();
    startClaudeTaskPlannerSchedule();
    startDailyPlanSchedule();
  }
  startTaskOutboxProcessor();
});
