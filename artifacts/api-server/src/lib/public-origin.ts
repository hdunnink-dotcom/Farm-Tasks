import type { Request } from "express";

function originFromConfiguredValue(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function firstConfiguredDomain(value: string | undefined): string | undefined {
  return value?.split(",").map((domain) => domain.trim()).find(Boolean);
}

export function configuredPublicOrigin(): string | null {
  return originFromConfiguredValue(process.env.FARM_PUBLIC_ORIGIN)
    ?? originFromConfiguredValue(firstConfiguredDomain(process.env.REPLIT_DOMAINS))
    ?? originFromConfiguredValue(process.env.REPLIT_INTERNAL_APP_DOMAIN)
    ?? originFromConfiguredValue(process.env.REPLIT_DEV_DOMAIN);
}

export function publicOrigin(req: Request): string {
  const configured = configuredPublicOrigin();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("A canonical public origin is required in production.");
  }
  const protocol = req.header("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host = req.header("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  return new URL(`${protocol}://${host}`).origin;
}