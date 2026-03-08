ARG NODE_IMAGE=node:24.11-alpine

# Stage 1: Build client
FROM ${NODE_IMAGE} AS client-builder
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY client/package.json ./client/
RUN pnpm install --filter client... --frozen-lockfile

COPY client/ ./client/
RUN pnpm --filter client run build-only

# Stage 2: Build server + create deploy bundle
FROM ${NODE_IMAGE} AS server-builder
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY server/package.json ./server/
RUN pnpm install --filter server... --frozen-lockfile

COPY server/ ./server/
RUN pnpm --filter server run build

# pnpm deploy prunes to prod deps; dist/ is gitignored so copy it in after.
RUN pnpm --filter server deploy --prod --legacy /deploy
RUN cp -r /app/server/dist /deploy/dist
RUN mkdir -p /deploy/migrations && cp -r /app/server/src/db/migrations/. /deploy/migrations/

# Stage 3: Runtime image
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=server-builder --chown=node:node /deploy ./
COPY --from=client-builder --chown=node:node /app/client/dist ./public
COPY --from=server-builder --chown=node:node /app/server/entrypoint.sh ./entrypoint.sh

RUN chmod +x /app/entrypoint.sh && mkdir -p /books /tmp && chown -R node:node /books /tmp

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://127.0.0.1:'+p+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "entrypoint.sh"]
