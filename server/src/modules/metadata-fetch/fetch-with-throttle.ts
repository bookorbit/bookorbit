import { ProviderThrottleError } from './provider-throttle.error';

export async function fetchWithThrottle(url: string | URL, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : undefined;
    throw new ProviderThrottleError(Number.isFinite(retryAfterSeconds) && retryAfterSeconds! > 0 ? retryAfterSeconds : undefined);
  }
  return res;
}
