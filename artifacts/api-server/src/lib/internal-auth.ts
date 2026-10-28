import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/**
 * Short-lived, signed identity for requests the server makes to itself
 * (the Claude connector's planner tools call the normal task endpoints so the
 * same validation, Sheet sync and daily-plan refresh apply). Accepted only on
 * loopback connections, never from the internet.
 */
export const INTERNAL_AUTH_HEADER = "x-farm-internal-member";
const TTL_MS = 60_000;

function key(): string {
  const secret = process.env.FARM_OAUTH_CLIENT_SECRET?.trim() || process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) throw new Error("No server secret is configured for internal requests.");
  return `farm-internal:${secret}`;
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function internalMemberToken(clerkId: string): string {
  const payload = Buffer.from(JSON.stringify({ c: clerkId, e: Date.now() + TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** The member a loopback request was signed for, or null. */
export function internalMemberId(req: Request): string | null {
  const raw = req.headers?.[INTERNAL_AUTH_HEADER];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || !isLoopback(req.socket?.remoteAddress)) return null;
  const [payload, signature] = header.split(".");
  if (!payload || !signature) return null;
  try {
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: string; e?: number };
    if (!parsed.c || !parsed.e || parsed.e < Date.now()) return null;
    return parsed.c;
  } catch {
    return null;
  }
}
