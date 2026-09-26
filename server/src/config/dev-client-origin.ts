/**
 * Where `pnpm dev` serves the web client (`server.port` in `client/vite.config.ts`), and the origin
 * every client-facing URL falls back to when `APP_URL` or `CLIENT_URL` is unset.
 */
export const DEV_CLIENT_ORIGIN = 'http://localhost:6263';
