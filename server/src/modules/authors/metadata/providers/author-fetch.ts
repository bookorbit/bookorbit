import { providerRequestKey, recordProviderRequest, recordProviderRequestError } from '../../../../common/provider-cache/provider-call-context';

/**
 * Every author provider HTTP call goes through here, so the metadata cache can see how each request
 * ended. A provider that skips it could have a failure cached as an empty answer.
 */
export async function authorProviderFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const requestKey = providerRequestKey(url, init);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    recordProviderRequestError(requestKey, error);
    throw error;
  }
  recordProviderRequest(requestKey, { kind: 'status', status: res.status });
  return res;
}

/** The per-request timeout, cut short when the caller's deadline aborts first. */
export function authorRequestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
