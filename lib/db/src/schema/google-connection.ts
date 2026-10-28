import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The single Google account the farm app acts as (Sheets, Calendar, Drive,
 * Gmail). Replaces Replit's managed connectors. The refresh token is stored
 * encrypted with GOOGLE_TOKEN_ENCRYPTION_KEY; there is only ever one row (id 1).
 */
export const googleConnection = pgTable("google_connection", {
  id: integer("id").primaryKey(),
  email: text("email").notNull().default(""),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").notNull().default(""),
  connectedByClerkId: text("connected_by_clerk_id").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GoogleConnection = typeof googleConnection.$inferSelect;
