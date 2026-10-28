import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Serializes creation for a stable client task ID across every API instance.
 * The transaction-scoped PostgreSQL advisory lock is automatically released
 * on success, error, or connection loss.
 */
export async function withTaskCreationLock<T>(
  clientTaskId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${clientTaskId}))`);
    return operation();
  });
}