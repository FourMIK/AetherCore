FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY services/lattice-bridge/package.json ./services/lattice-bridge/
COPY packages/shared/package.json ./packages/shared/

RUN corepack enable && SKIP_TOOLCHAIN_CHECK=1 pnpm install --frozen-lockfile --filter @aethercore/lattice-bridge --filter @aethercore/shared

COPY services/lattice-bridge ./services/lattice-bridge
COPY packages/shared ./packages/shared
RUN pnpm --filter @aethercore/shared run build \
  && pnpm --filter @aethercore/lattice-bridge run build \
  && pnpm --filter @aethercore/lattice-bridge --prod deploy /prod/lattice-bridge

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init wget \
  && addgroup -S aether && adduser -S -G aether aether

COPY --from=builder /prod/lattice-bridge ./

ENV NODE_ENV=production PORT=3010
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3010/health >/dev/null || exit 1

USER aether
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]

