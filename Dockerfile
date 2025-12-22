# Stage 1: Build client
FROM node:24-alpine AS client-builder
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# Stage 2: Build server
FROM node:24-alpine AS server-builder
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
RUN npm run build

# Stage 3: Final image — production only, no devDependencies
FROM node:24-alpine AS final
WORKDIR /app

COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/package.json ./package.json
COPY --from=server-builder /app/server/package-lock.json ./package-lock.json
RUN npm ci --omit=dev

# Vue build served as static files by NestJS
COPY --from=client-builder /app/client/dist ./public

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
