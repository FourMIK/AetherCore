FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY services/gateway/package.json ./services/gateway/
COPY packages/shared/package.json ./packages/shared/

RUN corepack enable && SKIP_TOOLCHAIN_CHECK=1 pnpm install --frozen-lockfile --filter @aethercore/gateway --filter @aethercore/shared

COPY services/gateway ./services/gateway
COPY packages/shared ./packages/shared
RUN pnpm --filter @aethercore/shared run build \
  && pnpm --filter @aethercore/gateway run build \
  && pnpm --filter @aethercore/gateway --prod deploy /prod/gateway

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init wget \
  && addgroup -S aether && adduser -S -G aether aether

COPY --from=builder /prod/gateway ./

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

USER aether
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
