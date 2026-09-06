ARG NODE_IMAGE=node:26.8.1-alpine3.23@sha256:871eb674ad6e692c91330a8959f1ce2f80ba3f445cdc54e306869d2ea265e42d

FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@11.22.0

# Stage 1: Build client
FROM base AS client-builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches/ ./patches/
COPY packages/types/package.json ./packages/types/
COPY client/package.json ./client/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --filter client... --frozen-lockfile

COPY packages/ ./packages/
COPY client/ ./client/
# pnpm 11 defaults verifyDepsBeforeRun to "install", so running a script
# re-installs first. Each stage installed its own filtered subset with a frozen
# lockfile two steps up, and no stage carries the whole workspace, so that
# re-install is both redundant and wrong: it resolves against a partial
# workspace. In the server stage it is fatal, because client/ is absent and the
# @embedpdf patches then look unused.
RUN pnpm --config.verify-deps-before-run=false --filter client run build-only

# Stage 2: Build server + create deploy bundle
FROM base AS server-builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches/ ./patches/
COPY packages/types/package.json ./packages/types/
COPY server/package.json ./server/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --filter server... --frozen-lockfile

COPY packages/ ./packages/
COPY server/ ./server/
RUN pnpm --config.verify-deps-before-run=false --filter server run build

# pnpm deploy prunes to prod deps; dist/ is gitignored so copy it in after.
RUN pnpm --config.allow-unused-patches=true --filter server deploy --prod --legacy /deploy
RUN cp -r /app/server/dist /deploy/dist
RUN mkdir -p /deploy/migrations && cp -r /app/server/src/db/migrations/. /deploy/migrations/

# Stage 3: Runtime image
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV KOBO_CLOUDSCRAPER_PYTHON=/opt/bookorbit-python/bin/python
ENV KOREADER_PLUGIN_PATH=/app/koreader-plugin/bookorbit.koplugin

COPY server/requirements/kobo-cloudscraper.txt /tmp/kobo-cloudscraper-requirements.txt

# pip is build-only here. Leaving it installed also leaves pip/_vendor/vendor.txt,
# which Trivy reads as installed msgpack and setuptools and fails the image scan on.
RUN apk upgrade --no-cache && \
    apk add --no-cache poppler-utils su-exec ffmpeg python3 py3-pip tini tzdata && \
    python3 -m venv /opt/bookorbit-python && \
    /opt/bookorbit-python/bin/python -m pip install --no-cache-dir -r /tmp/kobo-cloudscraper-requirements.txt && \
    /opt/bookorbit-python/bin/python -m pip uninstall -y pip && \
    apk del py3-pip && \
    rm -f /tmp/kobo-cloudscraper-requirements.txt && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=server-builder --chown=node:node /deploy ./
COPY --from=client-builder --chown=node:node /app/client/dist ./public
COPY --from=server-builder --chown=node:node /app/server/entrypoint.sh ./entrypoint.sh
COPY --chown=node:node server/bin/kepubify/ ./bin/kepubify/
COPY --chown=node:node koreader-plugin/bookorbit.koplugin/ ./koreader-plugin/bookorbit.koplugin/

RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh /app/bin/kepubify/* && mkdir -p /books /data/covers /data/book-bucket /tmp && chown -R node:node /data /tmp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -T 4 -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/v1/health"

ENTRYPOINT ["/sbin/tini", "-s", "--"]
CMD ["sh", "/app/entrypoint.sh"]
