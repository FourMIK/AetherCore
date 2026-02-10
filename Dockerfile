# syntax=docker/dockerfile:1.7

############################
# 1) Build the dashboard   #
############################
FROM node:20-alpine AS builder

# Use a dedicated work directory inside the build container.
WORKDIR /app

# Build-time API endpoint configuration (for Vite/React embedding).
# We support both REACT_APP_* (requested) and VITE_* conventions.
ARG REACT_APP_API_URL=https://mesh.example.com/api
ARG REACT_APP_WS_URL=wss://mesh.example.com/ws
ARG VITE_API_URL=${REACT_APP_API_URL}
ARG VITE_GATEWAY_URL=${REACT_APP_WS_URL}

ENV REACT_APP_API_URL=${REACT_APP_API_URL}
ENV REACT_APP_WS_URL=${REACT_APP_WS_URL}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_GATEWAY_URL=${VITE_GATEWAY_URL}

# Copy only dependency manifests first for better layer caching.
COPY package.json package-lock.json ./
COPY agent/linux/package.json agent/linux/package.json
COPY packages/h2-glass/package.json packages/h2-glass/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/canonical-schema/package.json packages/canonical-schema/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/auth/package.json services/auth/package.json
COPY services/collaboration/package.json services/collaboration/package.json
COPY services/fleet/package.json services/fleet/package.json
COPY services/gateway/package.json services/gateway/package.json
COPY services/h2-ingest/package.json services/h2-ingest/package.json
COPY services/operator/package.json services/operator/package.json

# Install workspace dependencies in a reproducible way.
RUN npm ci

# Copy the rest of the repository and build only the dashboard workspace.
COPY . .
RUN npm run build --workspace @aethercore/dashboard

##################################
# 2) Production runtime (nginx)  #
##################################
FROM nginx:alpine AS production

# Install curl for healthcheck and libcap to allow non-root nginx on :80.
RUN apk add --no-cache curl libcap gettext \
    && setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx \
    && mkdir -p /tmp/nginx /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
    && chown -R nginx:nginx /tmp/nginx /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp /usr/share/nginx/html /var/cache/nginx /etc/nginx \
    && apk del libcap

# Remove default nginx site config and add SPA-aware routing config.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf

# Copy compiled dashboard artifacts.
COPY --from=builder /app/packages/dashboard/dist/ /usr/share/nginx/html/

# Optional runtime environment bootstrap for browser-side config.
COPY docker/nginx/env.js.template /usr/share/nginx/html/env.js.template
COPY docker/nginx/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && chown nginx:nginx /docker-entrypoint.sh /usr/share/nginx/html/env.js.template

# Run as non-root in the final image.
USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost/ >/dev/null || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
