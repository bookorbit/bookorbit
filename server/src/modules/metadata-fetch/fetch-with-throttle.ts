import { ProviderThrottleError } from './provider-throttle.error';

function parseRetryAfterSeconds(retryAfter: string | null): number | undefined {
  if (!retryAfter) return undefined;

  const numeric = Number(retryAfter);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.ceil(numeric);
  }

  const retryAtEpochMs = Date.parse(retryAfter);
  if (Number.isNaN(retryAtEpochMs)) {
    return undefined;
  }

  const remainingSeconds = Math.ceil((retryAtEpochMs - Date.now()) / 1000);
  return remainingSeconds > 0 ? remainingSeconds : undefined;
}

export async function fetchWithThrottle(url: string | URL, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 429) {
    const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get('Retry-After'));
    throw new ProviderThrottleError(retryAfterSeconds);
  }
  return res;
}
