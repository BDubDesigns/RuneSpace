# RuneSpace — production build (Docker/Coolify-ready)
#
# Multi-stage build. Coolify can deploy this image directly; set DATABASE_URL
# and NODE_ENV via the Coolify environment UI. No gameplay is bundled — this is
# the foundation scaffold.

# ---- deps ----
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build needs a DATABASE_URL present; the runtime value is injected at deploy.
ARG DATABASE_URL=postgres://runespace:runespace@localhost:5432/runespace
ENV DATABASE_URL=$DATABASE_URL
ENV NODE_ENV=production
RUN pnpm build

# ---- runner ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/db ./db
COPY --from=builder /app/server ./server
# Keep the committed migration assets available for the operator-run Drizzle command.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/drizzle ./drizzle
RUN test -f drizzle.config.ts && test -f drizzle/meta/_journal.json

EXPOSE 3000
CMD ["pnpm", "start"]
