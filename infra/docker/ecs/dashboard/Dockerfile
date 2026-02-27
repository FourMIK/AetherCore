FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY agent/linux/package.json ./agent/linux/package.json
COPY packages/canonical-schema/package.json ./packages/canonical-schema/package.json
COPY packages/dashboard/package.json ./packages/dashboard/package.json
COPY packages/h2-glass/package.json ./packages/h2-glass/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY services/auth/package.json ./services/auth/package.json
COPY services/collaboration/package.json ./services/collaboration/package.json
COPY services/fleet/package.json ./services/fleet/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/h2-ingest/package.json ./services/h2-ingest/package.json
COPY services/operator/package.json ./services/operator/package.json

RUN corepack enable && SKIP_TOOLCHAIN_CHECK=1 pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @aethercore/dashboard run build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache gettext wget

COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/env.js.template /usr/share/nginx/html/env.js.template
COPY docker/nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=builder /app/packages/dashboard/dist/ /usr/share/nginx/html/

RUN mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp \
  && chown -R nginx:nginx /usr/share/nginx/html /tmp/nginx /var/cache/nginx \
  && chmod +x /docker-entrypoint.sh

ENV REACT_APP_API_URL=/api REACT_APP_WS_URL=wss://www.aether.authynticdefense.com/ws REACT_APP_TPM_ENABLED=true
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

USER nginx
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
