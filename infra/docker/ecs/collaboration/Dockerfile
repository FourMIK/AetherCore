FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY services/collaboration/package.json ./services/collaboration/
COPY packages/shared/package.json ./packages/shared/

RUN corepack enable && SKIP_TOOLCHAIN_CHECK=1 pnpm install --frozen-lockfile --filter @aethercore/collaboration --filter @aethercore/shared

COPY services/collaboration ./services/collaboration
COPY packages/shared ./packages/shared
RUN pnpm --filter @aethercore/collaboration run build

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init wget \
  && addgroup -S aether && adduser -S -G aether aether

COPY --from=builder /app/services/collaboration/dist ./dist
COPY --from=builder /app/services/collaboration/proto ./proto
COPY --from=builder /app/services/collaboration/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1

USER aether
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
