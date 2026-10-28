import type { IncomingHttpHeaders } from "http";
import type { RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

export const CLERK_PROXY_PATH = "/api/__clerk";

export function getClerkProxyHost(req: { headers: IncomingHttpHeaders }): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || req.headers.host?.trim() || undefined;
}

export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== "production" || !process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")) {
    return (_req, _res, next) => next();
  }
  return createProxyMiddleware({
    target: "https://frontend-api.clerk.dev",
    changeOrigin: true,
    pathRewrite: (path) => path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const forwardedProto = req.headers["x-forwarded-proto"];
        const rawProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
        const protocol = rawProto?.split(",")[0]?.trim() || "https";
        const host = getClerkProxyHost(req) ?? "";
        proxyReq.setHeader("Clerk-Proxy-Url", `${protocol}://${host}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY!);
      },
    },
  }) as RequestHandler;
}