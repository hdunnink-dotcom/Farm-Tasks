# Farm & Orchard Planner: API server + built web planner in one container
# (Google Cloud Run). Build with cloudbuild.yaml, which passes the Clerk key.

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
      --filter "@workspace/api-server..." \
      --filter "@workspace/farm-planner-web..."
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV NODE_ENV=production
RUN PORT=8080 BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" \
      pnpm --filter @workspace/farm-planner-web run build \
 && pnpm --filter @workspace/api-server run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/web \
    MIGRATIONS_DIR=/app/migrations \
    FARM_IN_PROCESS_SCHEDULERS=false
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/farm-planner-web/dist/public ./web
COPY --from=build /app/lib/db/drizzle ./migrations
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
