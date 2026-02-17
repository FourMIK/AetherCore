FROM node:20-alpine AS build
WORKDIR /workspace

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY services/auth/package.json services/auth/tsconfig.json ./services/auth/
COPY packages/shared/src ./packages/shared/src
COPY services/auth/src ./services/auth/src

RUN pnpm install --frozen-lockfile --filter @aethercore/auth...
RUN pnpm --filter @aethercore/shared build
RUN pnpm --filter @aethercore/auth build
RUN pnpm --filter @aethercore/auth deploy --prod /app

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build /app ./

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');http.get({host:'127.0.0.1',port:process.env.PORT||3001,path:'/health'},(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1));"

CMD ["node", "dist/server.js"]
