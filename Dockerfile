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
# Build-only placeholder so an ordinary `docker build` succeeds (`next build`
# runs with NODE_ENV=production and requires BETTER_AUTH_SECRET). It is scoped
# to the single build command below — never promoted to an ENV and never used
# at runtime. Coolify supplies the real BETTER_AUTH_SECRET when the
# application runs.
ARG BUILD_ONLY_BETTER_AUTH_SECRET=insecure-ci-build-only-secret-do-not-use-in-prod-0000000000
ENV NODE_ENV=production
# Issue #70: the canonical portrait master directory must never enter the
# Docker build context (.dockerignore) — this assertion fails the build if it
# does, proving the production image ships only the committed derivatives.
RUN test ! -e assets/character-portraits \
  && echo "portrait masters correctly excluded from the Docker build context"
RUN BETTER_AUTH_SECRET="$BUILD_ONLY_BETTER_AUTH_SECRET" pnpm build

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

EXPOSE 3000
CMD ["pnpm", "start"]
