FROM node:20-alpine AS build
WORKDIR /workspace

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY services/collaboration/package.json services/collaboration/tsconfig.json ./services/collaboration/
COPY packages/shared/src ./packages/shared/src
COPY services/collaboration/src ./services/collaboration/src
COPY services/collaboration/proto ./services/collaboration/proto

RUN pnpm install --frozen-lockfile --filter @aethercore/collaboration...
RUN pnpm --filter @aethercore/shared build
RUN pnpm --filter @aethercore/collaboration build
RUN pnpm --filter @aethercore/collaboration deploy --prod /app

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app ./

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');http.get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/health'},(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1));"

CMD ["node", "dist/index.js"]
