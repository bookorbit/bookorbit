import { ProviderThrottleError } from './provider-throttle.error';

export async function fetchWithThrottle(url: string | URL, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const parsedRetryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
    const retryAfterSeconds = Number.isFinite(parsedRetryAfterSeconds) && parsedRetryAfterSeconds > 0 ? parsedRetryAfterSeconds : undefined;
    throw new ProviderThrottleError(retryAfterSeconds);
  }
  return res;
}
