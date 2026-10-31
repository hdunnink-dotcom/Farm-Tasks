import path from "node:path";
import express, { type Express } from "express";
import compression from "compression";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Gzip JSON and the web app. The task list is large and phones in the field
// are often on a weak signal. Placed after the Clerk proxy, which streams
// already-encoded responses.
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Log why task changes are refused (4xx), so "Needs attention" errors in the
// planner can be traced. Only the short error message is logged.
app.use("/api/tasks", (req, res, next) => {
  if (req.method === "GET") { next(); return; }
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      const error = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error).slice(0, 300) : "";
      req.log.warn({ status: res.statusCode, error }, "Task change refused");
    }
    return json(body);
  };
  next();
});
app.use("/api", router);

// When STATIC_DIR is set (single-container hosting such as Cloud Run), serve
// the built web planner from the same origin, with an SPA fallback.
const staticDir = process.env.STATIC_DIR?.trim();
if (staticDir) {
  const root = path.resolve(staticDir);
  app.use(express.static(root, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(root, "index.html"));
  });
}

export default app;
