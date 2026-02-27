FROM node:20-alpine AS build
WORKDIR /workspace

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY services/gateway/package.json services/gateway/tsconfig.json ./services/gateway/
COPY services/gateway/scripts ./services/gateway/scripts
COPY services/gateway/proto ./services/gateway/proto
COPY packages/shared/src ./packages/shared/src
COPY services/gateway/src ./services/gateway/src

RUN pnpm install --frozen-lockfile --filter @aethercore/gateway...
RUN pnpm --filter @aethercore/shared build
RUN pnpm --filter @aethercore/gateway build
RUN pnpm --filter @aethercore/gateway deploy --prod /app

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app ./

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');http.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health'},(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1));"

CMD ["node", "dist/index.js"]
