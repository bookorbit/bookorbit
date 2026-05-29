const DEFAULT_TRUST_PROXY = 'loopback,linklocal,uniquelocal';

export function parseTrustProxy(value: string | undefined): string | boolean | number {
  const raw = value?.trim();
  if (!raw) return DEFAULT_TRUST_PROXY;

  const normalized = raw.toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;

  const hopCount = Number(raw);
  if (Number.isInteger(hopCount) && hopCount >= 0) return hopCount;

  return raw;
}

export function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const raw = value?.trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return fallback;
}

export interface CspOptions {
  allowCloudflareInsights?: boolean;
}

const CLOUDFLARE_INSIGHTS_SCRIPT_SRC = 'https://static.cloudflareinsights.com';
const CLOUDFLARE_INSIGHTS_CONNECT_SRC = 'https://cloudflareinsights.com';

export function buildCspDirectives(options: CspOptions = {}) {
  const { allowCloudflareInsights = false } = options;

  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...(allowCloudflareInsights ? [CLOUDFLARE_INSIGHTS_SCRIPT_SRC] : [])];
  const connectSrc = ["'self'", 'ws:', 'wss:', 'https://cdn.jsdelivr.net', ...(allowCloudflareInsights ? [CLOUDFLARE_INSIGHTS_CONNECT_SRC] : [])];

  return {
    defaultSrc: ["'self'"],
    scriptSrc,
    styleSrc: ["'self'", "'unsafe-inline'", 'blob:', 'https://fonts.googleapis.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc,
    mediaSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'data:', 'blob:', 'https://fonts.gstatic.com'],
    objectSrc: ["'none'"],
    frameSrc: ["'self'", 'blob:'],
    frameAncestors: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
    upgradeInsecureRequests: null,
  };
}
