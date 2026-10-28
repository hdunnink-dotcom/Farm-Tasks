import { Router, type IRouter, type Request, type Response } from "express";
import { callPlannerTool, plannerToolNames, plannerTools } from "../lib/planner-tools";
import {
  ApproveAssistantProposalBody,
  ApproveAssistantProposalParams,
  ApproveAssistantProposalResponse,
  ApproveAssistantProposalTaskBody,
  ApproveAssistantProposalTaskParams,
  ApproveAssistantProposalTaskResponse,
  CreateAssistantConnectorResponse,
  CreateAssistantTaskRequestBody,
  CreateAssistantTaskRequestResponse,
  GetAssistantSettingsResponse,
  ListAssistantApprovalRulesResponse,
  ListAssistantProposalsQueryParams,
  ListAssistantProposalsResponse,
  RejectAssistantProposalParams,
  RejectAssistantProposalResponse,
  RejectAssistantProposalTaskParams,
  RejectAssistantProposalTaskResponse,
  ScanAssistantSourcesResponse,
  UpdateAssistantApprovalRuleBody,
  UpdateAssistantApprovalRuleParams,
  UpdateAssistantApprovalRuleResponse,
  UpdateAssistantSettingsBody,
  UpdateAssistantSettingsResponse,
} from "@workspace/api-zod";
import { db, farmMembers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authDisabled, currentMember, isMaster, requireMember } from "../lib/farm-access";
import {
  approveProposal,
  approveProposalTask,
  getTaskPlannerSettings,
  listApprovalRules,
  listTaskProposals,
  rejectProposal,
  rejectProposalTask,
  scanTaskSources,
  updateApprovalRule,
  updateTaskPlannerSettings,
  createTaskRequest,
} from "../lib/claude-task-planner";
import {
  createAuthorizationCode,
  createRegisteredClientId,
  exchangeAuthorizationCode,
  isRegisteredRedirectUri,
  rotateRefreshToken,
  verifyOAuthAccessToken,
} from "../lib/claude-connector-oauth";
import { publicOrigin } from "../lib/public-origin";

const router: IRouter = Router();

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isHttpsRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function sendOAuthError(
  res: Response,
  status: number,
  error: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type",
  description: string,
) {
  res.status(status).json({ error, error_description: description });
}

function sendMcpUnauthorized(
  req: Request,
  res: Response,
) {
  const resourceMetadata = `${publicOrigin(req)}/api/assistant/.well-known/oauth-protected-resource`;
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="Farm Planner", scope="task_request", resource_metadata="${resourceMetadata}"`,
  );
  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Connect this Farm Planner owner account with OAuth to use this tool.",
    },
  });
}

async function owner(req: Parameters<typeof requireMember>[0], res: Parameters<typeof requireMember>[1]) {
  const member = await requireMember(req, res);
  if (!member || !isMaster(member)) {
    if (member) res.status(403).json({ error: "Only the farm owner can use the task planning assistant." });
    return null;
  }
  return member;
}

router.get("/assistant/proposals", async (req, res): Promise<void> => {
  if (!await owner(req, res)) return;
  const query = ListAssistantProposalsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  res.json(ListAssistantProposalsResponse.parse(await listTaskProposals(query.data.status)));
});

router.post("/assistant/scan", async (req, res): Promise<void> => {
  const member = await owner(req, res);
  if (!member) return;
  try {
    res.json(ScanAssistantSourcesResponse.parse(await scanTaskSources(member.clerkId)));
  } catch (error) {
    req.log.error({ err: error }, "Claude task planner scan failed");
    res.status(502).json({ error: "The assistant could not read its planning sources right now." });
  }
});

router.post("/assistant/proposals/:proposalId/approve", async (req, res): Promise<void> => {
  const member = await owner(req, res);
  if (!member) return;
  const params = ApproveAssistantProposalParams.safeParse(req.params);
  const body = ApproveAssistantProposalBody.safeParse(req.body ?? {});
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    res.json(ApproveAssistantProposalResponse.parse(await approveProposal(params.data.proposalId, member.clerkId, body.data)));
  } catch (error) {
    req.log.error({ err: error, proposalId: params.data.proposalId }, "Could not approve Claude proposal");
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not approve this proposal." });
  }
});

router.post("/assistant/proposals/:proposalId/reject", async (req, res): Promise<void> => {
  const member = await owner(req, res);
  if (!member) return;
  const params = RejectAssistantProposalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  res.json(RejectAssistantProposalResponse.parse(await rejectProposal(params.data.proposalId, member.clerkId)));
});

router.post("/assistant/proposals/:proposalId/tasks/:taskId/approve", async (req, res): Promise<void> => {
  const member = await owner(req, res);
  if (!member) return;
  const params = ApproveAssistantProposalTaskParams.safeParse(req.params);
  const body = ApproveAssistantProposalTaskBody.safeParse(req.body ?? {});
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    res.json(ApproveAssistantProposalTaskResponse.parse(await approveProposalTask(params.data.proposalId, params.data.taskId, member.clerkId, body.data)));
  } catch (error) {
    req.log.error({ err: error, proposalId: params.data.proposalId, taskId: params.data.taskId }, "Could not approve Claude suggestion");
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not approve this suggestion." });
  }
});

router.post("/assistant/proposals/:proposalId/tasks/:taskId/reject", async (req, res): Promise<void> => {
  const member = await owner(req, res);
  if (!member) return;
  const params = RejectAssistantProposalTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  res.json(RejectAssistantProposalTaskResponse.parse(await rejectProposalTask(params.data.proposalId, params.data.taskId, member.clerkId)));
});

router.get("/assistant/rules", async (req, res): Promise<void> => {
  if (!await owner(req, res)) return;
  res.json(ListAssistantApprovalRulesResponse.parse(await listApprovalRules()));
});

router.patch("/assistant/rules/:ruleId", async (req, res): Promise<void> => {
  if (!await owner(req, res)) return;
  const params = UpdateAssistantApprovalRuleParams.safeParse(req.params);
  const body = UpdateAssistantApprovalRuleBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    res.json(UpdateAssistantApprovalRuleResponse.parse(await updateApprovalRule(params.data.ruleId, body.data)));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Rule not found." });
  }
});

router.get("/assistant/settings", async (req, res): Promise<void> => {
  if (!await owner(req, res)) return;
  res.json(GetAssistantSettingsResponse.parse(await getTaskPlannerSettings()));
});

router.patch("/assistant/settings", async (req, res): Promise<void> => {
  if (!await owner(req, res)) return;
  const body = UpdateAssistantSettingsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  res.json(UpdateAssistantSettingsResponse.parse(await updateTaskPlannerSettings(body.data)));
});

router.post("/assistant/task-request", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
  const body = CreateAssistantTaskRequestBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (member.role === "worker" && (
    !body.data.whatNeedsDoing?.trim()
    || !body.data.forWhom?.trim()
    || !body.data.priority
    || !body.data.dueDateTime?.trim()
  )) {
    res.status(400).json({ error: "Workers must provide what needs doing, who it is for, priority, and a due date or time." });
    return;
  }
  try {
    res.status(201).json(CreateAssistantTaskRequestResponse.parse({
       ...(await createTaskRequest(member.clerkId, { ...body.data, requesterName: member.displayName })),
      status: "pending_approval",
    }));
  } catch (error) {
    req.log.error({ err: error }, "Claude task request failed");
    res.status(502).json({ error: "Claude could not draft this task right now." });
  }
});

router.post("/assistant/connector", async (req, res): Promise<void> => {
  if (!await owner(req, res)) return;
  const origin = publicOrigin(req);
  res.json(CreateAssistantConnectorResponse.parse({
    endpoint: `${origin}/api/assistant/mcp`,
    authorizationUrl: `${origin}/api/assistant/oauth/authorize`,
    instructions: "Paste this endpoint into a Claude.ai remote connector. Use Claude’s default OAuth discovery instead of “Own OAuth”; do not enter a client ID or client secret. Claude will open Farm Planner for a one-time owner sign-in and approval, then refreshes access automatically.",
  }));
});

router.get("/assistant/.well-known/oauth-protected-resource", (req, res): void => {
  const origin = publicOrigin(req);
  res.json({
    resource: `${origin}/api/assistant/mcp`,
    authorization_servers: [`${origin}/api/assistant`],
    scopes_supported: ["task_request"],
    bearer_methods_supported: ["header"],
  });
});

function oauthServerMetadata(req: Request) {
  const origin = publicOrigin(req);
  const issuer = `${origin}/api/assistant`;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["task_request"],
  };
}

router.get("/assistant/.well-known/oauth-authorization-server", (req, res): void => {
  res.json(oauthServerMetadata(req));
});

// Claude's custom OAuth setup may use OpenID discovery even when no OIDC
// identity claims are requested. Serve the OAuth metadata at that alias too.
router.get("/assistant/.well-known/openid-configuration", (req, res): void => {
  res.json(oauthServerMetadata(req));
});

// Some MCP clients resolve the authorization server metadata relative to the
// OAuth endpoint itself. Keep this compatibility alias alongside the standard
// protected-resource discovery locations.
router.get("/assistant/oauth/.well-known/authorization-server", (req, res): void => {
  res.json(oauthServerMetadata(req));
});

router.get("/assistant/oauth/.well-known/openid-configuration", (req, res): void => {
  res.json(oauthServerMetadata(req));
});

router.post("/assistant/oauth/register", (req, res): void => {
  const candidateRedirectUris: unknown[] = Array.isArray(req.body?.redirect_uris)
    ? req.body.redirect_uris
    : [];
  const redirectUris = [...new Set(candidateRedirectUris.filter(
    (value): value is string => typeof value === "string",
  ))];
  if (
    !redirectUris.length
    || redirectUris.length !== candidateRedirectUris.length
    || redirectUris.length > 10
    || redirectUris.some((uri) => uri.length > 2048 || !isHttpsRedirectUri(uri))
  ) {
    sendOAuthError(res, 400, "invalid_request", "At least one HTTPS redirect URI is required.");
    return;
  }
  const clientId = createRegisteredClientId(redirectUris);
  if (!clientId) {
    sendOAuthError(res, 500, "invalid_client", "OAuth client registration is not configured.");
    return;
  }
  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof req.body?.client_name === "string" ? req.body.client_name : "Claude",
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
});

router.get("/assistant/oauth/authorize", async (req, res): Promise<void> => {
  const responseType = stringValue(req.query.response_type);
  const clientId = stringValue(req.query.client_id);
  const redirectUri = stringValue(req.query.redirect_uri);
  const codeChallenge = stringValue(req.query.code_challenge);
  const codeChallengeMethod = stringValue(req.query.code_challenge_method);
  const state = stringValue(req.query.state);
  if (
    responseType !== "code" ||
    !clientId ||
    !isHttpsRedirectUri(redirectUri) ||
    !isRegisteredRedirectUri(clientId, redirectUri) ||
    codeChallenge.length < 43 ||
    codeChallengeMethod !== "S256"
  ) {
    sendOAuthError(res, 400, "invalid_request", "OAuth authorization requires an HTTPS redirect URI and an S256 PKCE challenge.");
    return;
  }

  const member = await currentMember(req);
  if (!member || !isMaster(member)) {
    const signInUrl = new URL("/sign-in", publicOrigin(req));
    signInUrl.searchParams.set("redirect_url", `${publicOrigin(req)}${req.originalUrl}`);
    res.redirect(302, signInUrl.toString());
    return;
  }
  const code = await createAuthorizationCode({
    clerkId: member.clerkId,
    clientId,
    redirectUri,
    codeChallenge,
  });
  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code);
  if (state) destination.searchParams.set("state", state);
  res.redirect(302, destination.toString());
});

router.post("/assistant/oauth/token", async (req, res): Promise<void> => {
  const grantType = stringValue(req.body?.grant_type);
  const clientId = stringValue(req.body?.client_id);
  if (!clientId) {
    sendOAuthError(res, 400, "invalid_client", "A client_id is required.");
    return;
  }
  if (grantType === "authorization_code") {
    const response = await exchangeAuthorizationCode({
      code: stringValue(req.body?.code),
      codeVerifier: stringValue(req.body?.code_verifier),
      clientId,
      redirectUri: stringValue(req.body?.redirect_uri),
    });
    if (!response) {
      sendOAuthError(res, 400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
      return;
    }
    res.json({
      access_token: response.accessToken,
      token_type: "Bearer",
      expires_in: response.expiresIn,
      refresh_token: response.refreshToken,
      scope: "task_request",
    });
    return;
  }
  if (grantType === "refresh_token") {
    const response = await rotateRefreshToken({
      refreshToken: stringValue(req.body?.refresh_token),
      clientId,
    });
    if (!response) {
      sendOAuthError(res, 400, "invalid_grant", "The refresh token is invalid, expired, or revoked.");
      return;
    }
    res.json({
      access_token: response.accessToken,
      token_type: "Bearer",
      expires_in: response.expiresIn,
      refresh_token: response.refreshToken,
      scope: "task_request",
    });
    return;
  }
  sendOAuthError(res, 400, "unsupported_grant_type", "Supported grants are authorization_code and refresh_token.");
});

router.post("/assistant/mcp", async (req, res): Promise<void> => {
  const authorization = req.header("authorization") ?? "";
  const clerkId = authorization.startsWith("Bearer ")
    ? await verifyOAuthAccessToken(authorization.slice(7).trim())
    : null;
  const member = clerkId
    ? authDisabled && clerkId === "test-master"
      ? await currentMember(req)
      : (await db.select().from(farmMembers).where(eq(farmMembers.clerkId, clerkId)).limit(1))[0] ?? null
    : null;
  if (!member || !isMaster(member)) {
    sendMcpUnauthorized(req, res);
    return;
  }
  const id = req.body?.id ?? null;
  if (req.body?.method === "initialize") {
    res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "Farm Planner", version: "1.0" } } });
    return;
  }
  if (req.body?.method === "notifications/initialized") { res.status(202).end(); return; }
  if (req.body?.method === "tools/list") {
    res.json({ jsonrpc: "2.0", id, result: { tools: [...plannerTools, { name: "task_request", description: "Draft one farm task using the owner's Farm Planner playbook and the Claude Project context supplied by Claude. Creates a pending proposal only.", inputSchema: { type: "object", properties: { request: { type: "string" }, claudeProjectContext: { type: "string" }, requestId: { type: "string", description: "Stable unique id for retry-safe delivery" } }, required: ["request", "requestId"] } }] } });
    return;
  }
  if (req.body?.method === "tools/call" && plannerToolNames.has(req.body?.params?.name)) {
    try {
      const result = await callPlannerTool(member.clerkId, req.body.params.name, req.body.params.arguments);
      res.json({ jsonrpc: "2.0", id, result: { ...(result.isError ? { isError: true } : {}), content: [{ type: "text", text: result.text }] } });
    } catch (error) {
      req.log.error({ err: error, tool: req.body.params.name }, "Planner tool failed");
      res.json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "The Farm Planner could not complete that action." }] } });
    }
    return;
  }
  if (req.body?.method === "tools/call" && req.body?.params?.name === "task_request") {
    const parsed = CreateAssistantTaskRequestBody.safeParse(req.body.params.arguments);
    if (!parsed.success) { res.json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: parsed.error.message }] } }); return; }
    try {
      const result = await createTaskRequest(member.clerkId, parsed.data);
      res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ status: "pending_approval", proposalId: result.proposal.id, duplicate: result.duplicate, message: "Delivered to the Farm Planner owner approval inbox. Nothing was written to Google Sheets." }) }] } });
    } catch {
      res.json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "The Farm Planner could not save this pending request." }] } });
    }
    return;
  }
  res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported MCP method." } });
});

export default router;