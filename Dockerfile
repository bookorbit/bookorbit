# Stage 1: Build client
FROM node:24-alpine AS client-builder
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY client/package.json ./client/
RUN pnpm install --filter client... --frozen-lockfile

COPY client/ ./client/
RUN pnpm --filter client run build-only

# Stage 2: Build server + create prod deploy bundle
FROM node:24-alpine AS server-builder
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ packages/
COPY server/package.json ./server/
RUN pnpm install --filter server... --frozen-lockfile

COPY server/ ./server/
RUN pnpm --filter server run build

# pnpm deploy prunes to prod deps; dist/ is gitignored so copy it in after
RUN pnpm --filter server deploy --prod --legacy /deploy
RUN cp -r /app/server/dist /deploy/dist

# Stage 3: Final image
FROM node:24-alpine
WORKDIR /app

COPY --from=server-builder /deploy ./
COPY --from=client-builder /app/client/dist ./public

EXPOSE 3000
ENV NODE_ENV=production

COPY --from=server-builder /app/server/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

CMD ["sh", "entrypoint.sh"]
