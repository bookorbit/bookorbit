ARG NODE_IMAGE=node:24.11-alpine

FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@10

# Stage 1: Build client
FROM base AS client-builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY client/package.json ./client/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --filter client... --frozen-lockfile

COPY packages/ ./packages/
COPY client/ ./client/
RUN pnpm --filter client run build-only

# Stage 2: Build server + create deploy bundle
FROM base AS server-builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY server/package.json ./server/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --filter server... --frozen-lockfile

COPY packages/ ./packages/
COPY server/ ./server/
RUN pnpm --filter server run build

# pnpm deploy prunes to prod deps; dist/ is gitignored so copy it in after.
RUN pnpm --filter server deploy --prod --legacy /deploy
RUN cp -r /app/server/dist /deploy/dist
RUN mkdir -p /deploy/migrations && cp -r /app/server/src/db/migrations/. /deploy/migrations/

# Stage 3: Runtime image
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

RUN apk upgrade --no-cache && \
    apk add --no-cache poppler-utils su-exec && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=server-builder --chown=node:node /deploy ./
COPY --from=client-builder --chown=node:node /app/client/dist ./public
COPY --from=server-builder --chown=node:node /app/server/entrypoint.sh ./entrypoint.sh

RUN chmod +x /app/entrypoint.sh && mkdir -p /books /data/covers /data/book-bucket /tmp && chown -R node:node /data /tmp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://127.0.0.1:'+p+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "/app/entrypoint.sh"]
