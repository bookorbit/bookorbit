import { providerRequestKey, recordProviderRequest, recordProviderRequestError } from '../../common/provider-cache/provider-call-context';
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

export interface FetchWithThrottleOptions {
  /** Statuses that are a normal answer for this request, such as 404 for optional data. */
  acceptedStatuses?: readonly number[];
}

/** Every provider HTTP call goes through here, so the metadata cache can see how each one ended. */
export async function fetchWithThrottle(url: string | URL, options?: RequestInit, egress?: FetchWithThrottleOptions): Promise<Response> {
  const requestKey = providerRequestKey(url, options);
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (error) {
    recordProviderRequestError(requestKey, error);
    throw error;
  }
  recordProviderRequest(requestKey, { kind: 'status', status: res.status, accepted: egress?.acceptedStatuses?.includes(res.status) === true });
  if (res.status === 429) {
    const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get('Retry-After'));
    throw new ProviderThrottleError(retryAfterSeconds);
  }
  return res;
}
