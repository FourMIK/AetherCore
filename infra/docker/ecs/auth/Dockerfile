FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY services/auth/package.json ./services/auth/
COPY packages/shared/package.json ./packages/shared/

RUN corepack enable && SKIP_TOOLCHAIN_CHECK=1 pnpm install --frozen-lockfile --filter @aethercore/auth --filter @aethercore/shared

COPY services/auth ./services/auth
COPY packages/shared ./packages/shared
RUN pnpm --filter @aethercore/shared run build \
  && pnpm --filter @aethercore/auth run build \
  && pnpm --filter @aethercore/auth --prod deploy /prod/auth

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init wget \
  && addgroup -S aether && adduser -S -G aether aether

COPY --from=builder /prod/auth ./

ENV NODE_ENV=production PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1

USER aether
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
