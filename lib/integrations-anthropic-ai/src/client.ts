import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";

/**
 * Claude API client.
 *
 * On Google Cloud Run the app proves its identity with a Google-signed token
 * (workload identity federation), so no API key is stored anywhere. Locally or
 * in tests, ANTHROPIC_API_KEY (or the legacy Replit integration variables) can
 * be used instead. The client is created on first use so that importing this
 * module never fails when AI is not configured.
 */

const GOOGLE_METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://api.anthropic.com&format=full";

async function fetchGoogleIdentityToken(): Promise<string> {
  const response = await fetch(GOOGLE_METADATA_IDENTITY_URL, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!response.ok) {
    throw new Error(`Google identity token request failed (${response.status}).`);
  }
  return response.text();
}

function createClient(): Anthropic {
  const federationRuleId = process.env.ANTHROPIC_FEDERATION_RULE_ID?.trim();
  const organizationId = process.env.ANTHROPIC_ORGANIZATION_ID?.trim();
  if (federationRuleId && organizationId) {
    const baseURL = process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com";
    return new Anthropic({
      baseURL,
      credentials: oidcFederationProvider({
        identityTokenProvider: fetchGoogleIdentityToken,
        federationRuleId,
        organizationId,
        serviceAccountId: process.env.ANTHROPIC_SERVICE_ACCOUNT_ID?.trim() || undefined,
        workspaceId: process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined,
        baseURL,
        fetch,
      }),
    });
  }

  const legacyBaseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL?.trim();
  const legacyKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY?.trim();
  if (legacyBaseURL && legacyKey) {
    return new Anthropic({ apiKey: legacyKey, baseURL: legacyBaseURL });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) return new Anthropic({ apiKey });

  throw new Error(
    "Claude is not configured. Set ANTHROPIC_FEDERATION_RULE_ID and ANTHROPIC_ORGANIZATION_ID (Google Cloud) or ANTHROPIC_API_KEY.",
  );
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  client ??= createClient();
  return client;
}

/** Lazily created client; the first property access builds it. */
export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Model used for planning features; override with CLAUDE_MODEL. */
export function claudeModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-5-5";
}

/** Cheaper model for simple jobs such as ordering the daily plan; override with CLAUDE_FAST_MODEL. */
export function claudeFastModel(): string {
  return process.env.CLAUDE_FAST_MODEL?.trim() || "claude-haiku-5-5";
}
