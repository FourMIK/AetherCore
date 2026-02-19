FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY services/operator/package.json ./services/operator/
COPY packages/shared/package.json ./packages/shared/

RUN corepack enable && SKIP_TOOLCHAIN_CHECK=1 pnpm install --frozen-lockfile --filter @aethercore/operator --filter @aethercore/shared

COPY services/operator ./services/operator
COPY packages/shared ./packages/shared
RUN pnpm --filter @aethercore/shared run build
RUN pnpm --filter @aethercore/operator run build

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init wget \
  && addgroup -S aether && adduser -S -G aether aether

COPY --from=builder /app/services/operator/dist ./dist
COPY --from=builder /app/services/operator/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production OPERATOR_HTTP_PORT=4001 RUN_HTTP_SERVER=true
EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4001/health >/dev/null || exit 1

USER aether
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
