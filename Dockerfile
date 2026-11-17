ARG NODE_IMAGE=node:26.12.1-alpine3.23@sha256:bc2b334006f15c7167bbeb2f08f28c2df883f7594a0470e04454ebe7560cfe68

# Build kepubify from source so the Go stdlib and Go deps compiled into it stay
# patched (prebuilt binaries carry whatever Go they were built with, which
# Trivy flags).
#  - KEPUBIFY_REF is the same upstream commit the old bundled binaries used.
#  - golang.org/x/text and x/sync are bumped to latest (upstream pins old,
#    vulnerable versions).
#  - GO_MIN_VERSION is a floor: with GOTOOLCHAIN=auto, Go downloads that
#    toolchain if the image's Go is older (the official image sets
#    GOTOOLCHAIN=local, and a cached golang:1.27 tag can lag behind).
#  - The output is named the way KepubifyBinaryService looks it up.
FROM golang:1.27-alpine AS kepubify-builder
ARG TARGETARCH
ARG KEPUBIFY_REF=9546034bc023891af5ce30709de6ae2dcf264628
ARG GO_MIN_VERSION=1.27.2
ENV CGO_ENABLED=0 GOTOOLCHAIN=auto
WORKDIR /build
RUN case "${TARGETARCH}" in \
      amd64) name=kepubify-linux-64bit ;; \
      arm64) name=kepubify-linux-arm64 ;; \
      arm)   name=kepubify-linux-arm ;; \
      386)   name=kepubify-linux-32bit ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    go mod init kepubify-build && \
    go mod edit -go=${GO_MIN_VERSION} && \
    go get github.com/pgaskin/kepubify/v4/cmd/kepubify@${KEPUBIFY_REF} \
           golang.org/x/text@latest golang.org/x/sync@latest && \
    go version && \
    mkdir -p /out && \
    go build -trimpath -ldflags="-s -w" -o "/out/${name}" github.com/pgaskin/kepubify/v4/cmd/kepubify && \
    go version -m "/out/${name}"

FROM ${NODE_IMAGE} AS base

# Install exactly the pnpm version the repo declares in "packageManager".
# If the installed pnpm differs from it, pnpm 11 tries to switch versions and
# must verify that version's native binary against pnpm-lock.yaml, which fails
# on platforms missing from the lockfile (e.g. @pnpm/exe.linux-arm64).
COPY package.json /tmp/package.json
RUN PNPM_VERSION="$(node -p "require('/tmp/package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]")" && \
    npm install -g "pnpm@${PNPM_VERSION}" && \
    rm /tmp/package.json

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
# pnpm deploy copies all of server/, including the prebuilt kepubify binaries.
# Drop them so only the kepubify-builder output ships.
RUN rm -rf /deploy/bin/kepubify
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
    apk add --no-cache 'libexpat>=2.9.0-r0' poppler-utils djvulibre util-linux su-exec ffmpeg python3 py3-pip tini tzdata && \
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
# The server reads its own translated text (achievements, monthly challenges) from the web's catalogs.
COPY --from=client-builder --chown=node:node /app/client/src/locales ./locales
COPY --from=server-builder --chown=node:node /app/server/entrypoint.sh /app/server/file-env.sh ./
COPY --chown=node:node LICENSE NOTICE ADDITIONAL_TERMS.md ./
COPY --from=kepubify-builder --chown=node:node /out/ ./bin/kepubify/
COPY --chown=node:node koreader-plugin/bookorbit.koplugin/ ./koreader-plugin/bookorbit.koplugin/

RUN sed -i 's/\r$//' /app/entrypoint.sh /app/file-env.sh && chmod +x /app/entrypoint.sh /app/bin/kepubify/* && mkdir -p /books /data/covers /data/book-bucket /tmp && chown -R node:node /data /tmp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD host="$(printf '%s' "${HOST:-}" | tr -d '[:space:]')"; \
      case "$host" in \
        ''|0.0.0.0) host=127.0.0.1 ;; \
        ::) host='[::1]' ;; \
        *:*) host="[$host]" ;; \
      esac; \
      wget -q -T 4 -O /dev/null "http://${host}:${PORT:-3000}/api/v1/health"

ENTRYPOINT ["/sbin/tini", "-s", "--"]
CMD ["sh", "/app/entrypoint.sh"]
