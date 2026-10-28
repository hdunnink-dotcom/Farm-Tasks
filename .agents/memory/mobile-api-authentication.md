---
name: Mobile API authentication
description: Why the Expo app must configure bearer authentication separately from the web app
---

The Expo app must register a token getter with the shared API client inside the Clerk provider. Browser cookie authentication does not carry over to React Native requests.

**Why:** The mobile app can reach the API while every protected task request still returns 401 if it only configures the API base URL.

**How to apply:** Keep the token getter tied to Clerk's loaded session, clear it when the provider unmounts, and leave web requests cookie-based.