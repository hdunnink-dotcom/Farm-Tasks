---
name: Claude MCP OAuth
description: Security and lifecycle rules for Claude's Farm Planner remote MCP connector.
---

The Claude remote connector uses OAuth authorization-code flow with S256 PKCE, short-lived access tokens, and rotating refresh tokens. Do not restore a manually copied durable Bearer token to the owner UI.

**Why:** A copied long-lived credential expires unpredictably, requires manual maintenance, and can be disclosed outside the intended connector. OAuth lets the owner approve access in-browser once while preserving revocation and refresh rotation.

**How to apply:** Keep the connector owner-bound and approval-only. Persist only token hashes, validate the owner's active role when an access token is used, issue access tokens for one hour, and rotate refresh tokens on every exchange. Bind every client ID—including compatibility IDs—to exact registered redirect URIs; never preserve compatibility by accepting arbitrary callbacks. Keep the OAuth metadata and MCP unauthorized challenge available for automatic connector discovery.