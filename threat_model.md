# Threat Model

## Project Overview

Farm & Orchard Planner is a public Replit autoscale deployment with a React web client, an Expo/React Native mobile client, and a Node.js 24/Express 5 API. Clerk supplies user authentication. Farm tasks are read from and written to a connected Google Sheet; farm membership and private attachment metadata are stored in PostgreSQL via Drizzle; attachment objects use private Replit/Google object storage; Orchard Management events are imported from a connected Google Calendar.

## Assets

- **Clerk identities and sessions** — compromise or authentication confusion exposes farm work and permits task or attachment changes.
- **Farm tasks and assignment metadata** — task notes, locations, links, completion state, assignee IDs/names, and subtasks are operational and potentially private; unauthorized edits can disrupt farm operations.
- **Private attachments** — uploaded field photos and files may contain sensitive farm or personal information.
- **Membership and role records** — the master/worker role and active status determine administrative access.
- **Google Sheet and Calendar data** — the connected integrations are the source of truth and can contain private operational data; connector credentials permit reads and writes.
- **Database and object-storage credentials** — compromise could expose or alter all membership metadata and uploaded objects.

## Trust Boundaries

- **Browser/mobile client to Express API** — clients and all request parameters are untrusted. Every sensitive route must authenticate and authorize the subject server-side.
- **Express API to PostgreSQL** — membership and attachment queries cross into a privileged data store; object IDs and owner/task IDs must be scoped to the authenticated member.
- **Express API to Google Sheets/Calendar connectors** — connector credentials are server-side privileged capabilities; public callers must not trigger unauthorized reads or writes or control connector paths.
- **Express API to private object storage** — signed upload/download URLs and streaming must be issued only after task/member authorization.
- **Public web/mobile static serving** — request paths and forwarding headers are attacker-controlled; path resolution and generated HTML must not disclose files or create script injection.
- **Master/worker boundary** — workers may access and update only assigned tasks and their permitted attachments; only the active master may manage team, create/delete/reassign tasks, or synchronize privileged integrations.

## Scan Anchors

- Production API: `artifacts/api-server/src/app.ts`, `src/routes/*.ts`, `src/lib/farm-access.ts`.
- Highest-risk paths: task assignment/mutation, team approval, attachment upload/content/signed URLs, Google Sheet writes, calendar sync, and Clerk proxy middleware.
- Public route: `/api/healthz`; authenticated farm routes should require an approved `farm_members` row; master-only operations include team management, task create/delete/reassignment, and calendar synchronization.
- Mobile static server: `artifacts/farm-planner-mobile/server/serve.js`; web client: `artifacts/farm-planner-web/src`; `artifacts/mockup-sandbox` is dev/mockup-only.

## Threat Categories

### Spoofing

Clerk authentication must be validated for every protected API operation, and a Clerk identity must map to an active approved farm member. Master recognition must not fall back to an attacker-controlled first login in production. Proxy headers and Clerk proxy configuration must not let an attacker redirect authentication traffic or expose secret headers.

### Tampering

Only the master may create/delete tasks or alter assignment fields. Workers may update completion and task details only for tasks assigned to their Clerk identity. Task IDs, assignee IDs, role/status fields, and attachment IDs are attacker-controlled selectors and require server-side relationship checks. Calendar imports must be protected and must not be triggerable by anonymous callers.

### Information Disclosure

Task lists, summaries, team records, and attachment bytes/URLs must be limited to the authenticated member's permitted farm scope. Private attachment storage must not be reachable through raw object paths or unbounded signed URLs. Logs and errors must not reveal bearer tokens, connector credentials, or private data. Static serving must stay within its intended root.

### Denial of Service

Public and authenticated endpoints must bound request bodies, upload metadata, connector work, calendar pagination, and repeated synchronization. Public callers must not be able to consume Google API quotas or cause expensive sheet/storage operations without authorization and rate controls.

### Elevation of Privilege

Role and status must be trusted only from server-side membership records. Client guards, hidden controls, request body fields, and arbitrary Clerk IDs are not authorization. Every team, task, attachment, and integration action must enforce the exact master/worker/object relationship before disclosure or mutation.

### Repudiation

Sensitive role changes, task mutations, attachment deletion, and integration synchronization should have reliable actor and timestamp auditability; application logs must preserve useful actor context without recording credentials or private payloads.
