import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, googleConnection } from "@workspace/db";

/**
 * Direct Google API access for the farm's Google account (Sheets, Calendar,
 * Drive, Gmail). This replaces Replit's managed connectors with the app's own
 * OAuth client: the farm owner connects once, and the refresh token is kept
 * encrypted in the database.
 */

export type GoogleService = "google-sheet" | "google-calendar" | "google-drive" | "google-mail";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const SERVICE_BASE_URLS: Record<GoogleService, string> = {
  "google-sheet": "https://sheets.googleapis.com",
  "google-calendar": "https://www.googleapis.com",
  "google-drive": "https://www.googleapis.com",
  "google-mail": "https://gmail.googleapis.com",
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CONNECTION_ID = 1;

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("The farm Google account is not connected yet. A farm manager can connect it at /api/google/connect.");
    this.name = "GoogleNotConnectedError";
  }
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set.");
  }
  return { clientId, clientSecret };
}

function encryptionKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be set.");
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised encrypted token format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// OAuth connect flow (state is HMAC-signed so it survives across instances)
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000;

function sign(value: string): string {
  return createHmac("sha256", encryptionKey()).update(value).digest("base64url");
}

export function createConnectState(clerkId: string): string {
  const payload = Buffer.from(JSON.stringify({ c: clerkId, e: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyConnectState(state: string): { clerkId: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: string; e?: number };
    if (!parsed.c || !parsed.e || parsed.e < Date.now()) return null;
    return { clerkId: parsed.c };
  } catch {
    return null;
  }
}

export function googleAuthUrl(input: { redirectUri: string; state: string; loginHint?: string }): string {
  const { clientId } = clientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

function emailFromIdToken(idToken: string | undefined): string {
  const payload = idToken?.split(".")[1];
  if (!payload) return "";
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return claims.email ?? "";
  } catch {
    return "";
  }
}

export async function completeGoogleConnection(input: { code: string; redirectUri: string; clerkId: string }): Promise<{ email: string; scopes: string }> {
  const { clientId, clientSecret } = clientCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string;
  };
  if (!response.ok || !body.refresh_token) {
    throw new Error(`Google did not return a refresh token (${body.error ?? response.status}${body.error_description ? `: ${body.error_description}` : ""}).`);
  }
  const email = emailFromIdToken(body.id_token);
  const values = {
    id: CONNECTION_ID,
    email,
    encryptedRefreshToken: encryptSecret(body.refresh_token),
    scopes: body.scope ?? "",
    connectedByClerkId: input.clerkId,
  };
  await db.insert(googleConnection).values(values).onConflictDoUpdate({ target: googleConnection.id, set: values });
  cachedToken = body.access_token && body.expires_in
    ? { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
    : undefined;
  return { email, scopes: values.scopes };
}

export async function googleConnectionStatus(): Promise<{ connected: boolean; email: string; scopes: string; updatedAt: string | null }> {
  const [row] = await db.select().from(googleConnection).where(eq(googleConnection.id, CONNECTION_ID)).limit(1);
  return {
    connected: Boolean(row),
    email: row?.email ?? "",
    scopes: row?.scopes ?? "",
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | undefined;
let pendingToken: Promise<string> | undefined;

async function refreshAccessToken(): Promise<string> {
  const [row] = await db.select().from(googleConnection).where(eq(googleConnection.id, CONNECTION_ID)).limit(1);
  if (!row) throw new GoogleNotConnectedError();
  const { clientId, clientSecret } = clientCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptSecret(row.encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`Google token refresh failed (${body.error ?? response.status}). Reconnect the farm Google account at /api/google/connect.`);
  }
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

export async function googleAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.token;
  pendingToken ??= refreshAccessToken().finally(() => { pendingToken = undefined; });
  return pendingToken;
}

/** Drop-in replacement for Replit's `ReplitConnectors().proxy(service, path, init)`. */
export class GoogleConnectors {
  async proxy(
    service: GoogleService,
    path: string,
    options?: { method?: string; headers?: Record<string, string>; body?: RequestInit["body"] },
  ): Promise<Response> {
    const url = `${SERVICE_BASE_URLS[service]}${path.startsWith("/") ? path : `/${path}`}`;
    const send = async (token: string) => fetch(url, {
      method: options?.method ?? "GET",
      headers: { ...(options?.headers ?? {}), authorization: `Bearer ${token}` },
      body: options?.body ?? undefined,
    });
    let response = await send(await googleAccessToken());
    if (response.status === 401) response = await send(await googleAccessToken(true));
    return response;
  }
}
