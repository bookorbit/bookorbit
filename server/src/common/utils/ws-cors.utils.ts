/** What a dev client is served from, and the only origin allowed when nothing was configured. */
const DEV_CLIENT_ORIGIN = 'http://localhost:5173';

/**
 * The origin a socket gateway's CORS check allows.
 *
 * `@WebSocketGateway` is evaluated while the class is being defined, before Nest has a container
 * to inject a typed config from, so this is one of the few places `process.env` is read outside
 * the config module. Shared so the fallback is stated once rather than once per gateway, and
 * reduced to an origin because that is what a browser sends: a `CLIENT_URL` carrying a trailing
 * slash or a path matches no `Origin` header at all, and the gateway then refuses every browser.
 */
export function wsCorsOrigin(): string {
  const configured = process.env.CLIENT_URL?.trim();
  if (!configured) return DEV_CLIENT_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    // Startup validation reports a malformed CLIENT_URL properly; refusing every browser here
    // would only make that failure look like a broken feature instead of a broken setting.
    return DEV_CLIENT_ORIGIN;
  }
}
