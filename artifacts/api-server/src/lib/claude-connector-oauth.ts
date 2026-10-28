import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { assistantOAuthCredentials, db } from "@workspace/db";

const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const AUTHORIZATION_CODE_LIFETIME_MS = 5 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const REGISTERED_CLIENT_PREFIX = "farm-planner-claude.";
export const LEGACY_CLAUDE_CLIENT_ID = "farm-planner-claude";
const LEGACY_CLAUDE_REDIRECT_URIS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
]);

type OAuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function clientRegistrationSecret(): string | null {
  return process.env.FARM_OAUTH_CLIENT_SECRET?.trim()
    || process.env.CLERK_SECRET_KEY?.trim()
    || null;
}

function signClientRegistration(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Dynamic client registrations are carried in a signed client id so they work
 * across API instances without adding a stateful registration dependency.
 */
export function createRegisteredClientId(redirectUris: string[]): string | null {
  const secret = clientRegistrationSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ redirectUris }), "utf8").toString("base64url");
  return `${REGISTERED_CLIENT_PREFIX}${payload}.${signClientRegistration(payload, secret)}`;
}

export function isRegisteredRedirectUri(clientId: string, redirectUri: string): boolean {
  // Preserve the published Claude client without allowing arbitrary callbacks.
  if (clientId === LEGACY_CLAUDE_CLIENT_ID) return LEGACY_CLAUDE_REDIRECT_URIS.has(redirectUri);
  if (!clientId.startsWith(REGISTERED_CLIENT_PREFIX)) return false;

  const secret = clientRegistrationSecret();
  if (!secret) return false;
  const encoded = clientId.slice(REGISTERED_CLIENT_PREFIX.length);
  const separator = encoded.lastIndexOf(".");
  if (separator <= 0) return false;
  const payload = encoded.slice(0, separator);
  const suppliedSignature = Buffer.from(encoded.slice(separator + 1));
  const expectedSignature = Buffer.from(signClientRegistration(payload, secret));
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) return false;

  try {
    const registration = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      redirectUris?: unknown;
    };
    return Array.isArray(registration.redirectUris)
      && registration.redirectUris.some((value) => value === redirectUri);
  } catch {
    return false;
  }
}

function expiresAfter(milliseconds: number): Date {
  return new Date(Date.now() + milliseconds);
}

function matchesPkceChallenge(verifier: string, challenge: string): boolean {
  const calculated = createHash("sha256").update(verifier).digest("base64url");
  const left = Buffer.from(calculated);
  const right = Buffer.from(challenge);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function issueTokens(input: {
  clerkId: string;
  clientId: string;
  redirectUri: string;
}): Promise<OAuthTokenResponse> {
  const accessToken = createToken();
  const refreshToken = createToken();
  await db.insert(assistantOAuthCredentials).values([
    {
      clerkId: input.clerkId,
      tokenHash: hashToken(accessToken),
      tokenType: "access_token",
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      expiresAt: expiresAfter(ACCESS_TOKEN_LIFETIME_MS),
    },
    {
      clerkId: input.clerkId,
      tokenHash: hashToken(refreshToken),
      tokenType: "refresh_token",
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      expiresAt: expiresAfter(REFRESH_TOKEN_LIFETIME_MS),
    },
  ]);
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_LIFETIME_MS / 1000,
  };
}

export async function createAuthorizationCode(input: {
  clerkId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = createToken();
  await db.insert(assistantOAuthCredentials).values({
    clerkId: input.clerkId,
    tokenHash: hashToken(code),
    tokenType: "authorization_code",
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    expiresAt: expiresAfter(AUTHORIZATION_CODE_LIFETIME_MS),
  });
  return code;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<OAuthTokenResponse | null> {
  const codeHash = hashToken(input.code);
  const [credential] = await db
    .select()
    .from(assistantOAuthCredentials)
    .where(eq(assistantOAuthCredentials.tokenHash, codeHash))
    .limit(1);

  if (
    !credential ||
    credential.tokenType !== "authorization_code" ||
    credential.usedAt ||
    credential.revokedAt ||
    credential.expiresAt <= new Date() ||
    credential.clientId !== input.clientId ||
    credential.redirectUri !== input.redirectUri ||
    !matchesPkceChallenge(input.codeVerifier, credential.codeChallenge)
  ) {
    return null;
  }

  const [consumed] = await db
    .update(assistantOAuthCredentials)
    .set({ usedAt: new Date() })
    .where(and(
      eq(assistantOAuthCredentials.id, credential.id),
      isNull(assistantOAuthCredentials.usedAt),
    ))
    .returning({ id: assistantOAuthCredentials.id });
  if (!consumed) return null;

  return issueTokens({
    clerkId: credential.clerkId,
    clientId: credential.clientId,
    redirectUri: credential.redirectUri,
  });
}

export async function rotateRefreshToken(input: {
  refreshToken: string;
  clientId: string;
}): Promise<OAuthTokenResponse | null> {
  const refreshHash = hashToken(input.refreshToken);
  const [credential] = await db
    .select()
    .from(assistantOAuthCredentials)
    .where(eq(assistantOAuthCredentials.tokenHash, refreshHash))
    .limit(1);

  if (
    !credential ||
    credential.tokenType !== "refresh_token" ||
    credential.revokedAt ||
    credential.expiresAt <= new Date() ||
    credential.clientId !== input.clientId
  ) {
    return null;
  }

  const [revoked] = await db
    .update(assistantOAuthCredentials)
    .set({ revokedAt: new Date(), usedAt: new Date() })
    .where(and(
      eq(assistantOAuthCredentials.id, credential.id),
      isNull(assistantOAuthCredentials.revokedAt),
    ))
    .returning({ id: assistantOAuthCredentials.id });
  if (!revoked) return null;

  return issueTokens({
    clerkId: credential.clerkId,
    clientId: credential.clientId,
    redirectUri: credential.redirectUri,
  });
}

export async function verifyOAuthAccessToken(token: string): Promise<string | null> {
  const [credential] = await db
    .select()
    .from(assistantOAuthCredentials)
    .where(eq(assistantOAuthCredentials.tokenHash, hashToken(token)))
    .limit(1);
  if (
    !credential ||
    credential.tokenType !== "access_token" ||
    credential.revokedAt ||
    credential.expiresAt <= new Date()
  ) {
    return null;
  }
  return credential.clerkId;
}