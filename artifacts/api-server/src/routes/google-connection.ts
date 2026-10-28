import { Router, type IRouter } from "express";
import { isMaster, requireMember } from "../lib/farm-access";
import {
  completeGoogleConnection,
  createConnectState,
  googleAuthUrl,
  googleConnectionStatus,
  verifyConnectState,
} from "../lib/google-connectors";
import { logger } from "../lib/logger";
import { publicOrigin } from "../lib/public-origin";

const router: IRouter = Router();

function redirectUri(req: Parameters<typeof publicOrigin>[0]): string {
  return `${publicOrigin(req)}/api/google/oauth/callback`;
}

function page(title: string, message: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>`
    + `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#1f2a1f;background:#f7f5ef}a{color:#2f6b3a}</style></head>`
    + `<body><h1>${escape(title)}</h1><p>${escape(message)}</p><p><a href="/">Back to the planner</a></p></body></html>`;
}

/** Start connecting the farm Google account. Farm managers only. */
router.get("/google/connect", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).send(page("Not allowed", "Only a farm manager can connect the farm Google account."));
    return;
  }
  const loginHint = typeof req.query.login_hint === "string" ? req.query.login_hint : process.env.GOOGLE_ACCOUNT_HINT?.trim();
  res.redirect(googleAuthUrl({ redirectUri: redirectUri(req), state: createConnectState(member.clerkId), loginHint }));
});

router.get("/google/oauth/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? verifyConnectState(req.query.state) : null;
  if (!state) {
    res.status(400).send(page("Link expired", "That Google sign-in link has expired. Start again from /api/google/connect."));
    return;
  }
  if (typeof req.query.error === "string") {
    res.status(400).send(page("Not connected", `Google said: ${req.query.error}.`));
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    res.status(400).send(page("Not connected", "Google did not return a sign-in code."));
    return;
  }
  try {
    const result = await completeGoogleConnection({ code, redirectUri: redirectUri(req), clerkId: state.clerkId });
    logger.info({ email: result.email }, "Farm Google account connected");
    res.send(page("Google connected", `The planner now uses ${result.email || "your Google account"} for the task sheet, calendar, Drive and Gmail. You can close this tab.`));
  } catch (error) {
    logger.error({ err: error }, "Google connection failed");
    res.status(502).send(page("Not connected", error instanceof Error ? error.message : "Google connection failed."));
  }
});

router.get("/google/status", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!isMaster(member)) {
    res.status(403).json({ error: "Farm managers only." });
    return;
  }
  res.json(await googleConnectionStatus());
});

export default router;
