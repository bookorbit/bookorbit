# Debian trixie for ffmpeg 7: STAlign's audiobook probe passes `ffprobe -output_format`, which the
# ffmpeg 5.1 in bookworm rejects, failing every job in its first stage.
ARG NODE_IMAGE=node:26.12.1-trixie-slim

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN npm install -g pnpm@11.22.0

# The image runs on CPU only: without this, onnxruntime-node downloads its CUDA provider on
# linux/x64, which cannot load here (no CUDA or cuDNN libraries) and only adds size.
ENV ONNXRUNTIME_NODE_INSTALL=skip

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches/ ./patches/
COPY packages/types/package.json ./packages/types/
COPY workers/read-aloud/package.json ./workers/read-aloud/
RUN --mount=type=cache,id=pnpm-read-aloud,target=/root/.local/share/pnpm/store \
    pnpm install --filter @bookorbit/read-aloud-worker... --frozen-lockfile

COPY packages/types/ ./packages/types/
COPY workers/read-aloud/ ./workers/read-aloud/
RUN pnpm --config.verify-deps-before-run=false --filter @bookorbit/types build && \
    pnpm --config.verify-deps-before-run=false --filter @bookorbit/read-aloud-worker build && \
    pnpm --config.allow-unused-patches=true --filter @bookorbit/read-aloud-worker deploy --prod --legacy /deploy && \
    rm -rf /deploy/dist /deploy/assets && \
    cp -r /app/workers/read-aloud/dist /app/workers/read-aloud/assets /deploy/ && \
    types_dir="$(dirname "$(cd /deploy && node -p 'require.resolve("@bookorbit/types/package.json")')")" && \
    rm -rf "$types_dir/dist" && cp -r /app/packages/types/dist "$types_dir/dist" && \
    cd /deploy && node -e 'require("@bookorbit/types").READ_ALOUD_WORKER_PROTOCOL || process.exit(1)' && \
    find node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6 -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} +

# Speech models reach the data volume (XDG_DATA_HOME) only through the ghost-story patch; without it
# they go to the home folder, which is read-only under Compose, and every model download fails.
RUN cd /deploy && \
    patched="$(find node_modules/.pnpm -path '*/node_modules/@storyteller-platform/ghost-story/dist/utilities/FileSystem.js')" && \
    if [ -z "$patched" ] || grep -L 'process.env\["XDG_DATA_HOME"\]' $patched | grep -q .; then \
      echo "ghost-story in the image lacks patches/@storyteller-platform__ghost-story@0.3.4.patch" >&2; exit 1; \
    fi

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates ffmpeg tini && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /data/read-aloud/jobs /data/read-aloud/tmp /data/read-aloud/ghost-story && \
    chown -R node:node /data

ENV NODE_ENV=production
ENV PORT=8787
ENV READ_ALOUD_WORKER_HOST=0.0.0.0
ENV READ_ALOUD_LIBRARY_ROOTS=/books
ENV READ_ALOUD_WORK_ROOT=/data/read-aloud/jobs
ENV READ_ALOUD_TMP_DIR=/data/read-aloud/tmp
ENV READ_ALOUD_CTC_DEVICE=auto
ENV TMPDIR=/data/read-aloud/tmp
ENV XDG_DATA_HOME=/data/read-aloud

COPY --from=builder --chown=node:node /deploy ./
COPY --chown=node:node server/file-env.sh workers/read-aloud/entrypoint.sh ./
RUN chmod +x /app/entrypoint.sh

# The release this image was built from, reported in health; unset falls back to the package version.
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}

USER node
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
