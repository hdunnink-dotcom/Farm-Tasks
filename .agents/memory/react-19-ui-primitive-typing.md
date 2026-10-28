---
name: React 19 UI primitive typing
description: Type-safe patterns for Recharts tooltips and input-otp context under the workspace React 19 types.
---

For Recharts tooltips, use the library's exported `TooltipProps` type rather than `React.ComponentProps<typeof Tooltip>`. For input-otp context, use its exported `RenderProps` shape when bridging the context type.

**Why:** These libraries' declarations can resolve React types differently under React 19, making component-instance inference fail even though their public prop and context contracts are valid.

**How to apply:** When updating the shared web UI primitives or their dependencies, keep explicit public-library types at the integration boundary instead of weakening TypeScript settings or adding error suppressions.