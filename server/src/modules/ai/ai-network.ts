import { BadRequestException, Injectable } from '@nestjs/common';
import type { AiFailureCode, NetworkProfile } from '@bookorbit/types';

import { ResponseTooLargeError, readBoundedText } from '../../common/utils/bounded-response';
import { safeFetch } from '../../common/utils/safe-fetch';
import { LinkLocalAddressException, PrivateAddressException, RemoteHostResolutionException } from '../../common/utils/ssrf.utils';

/** Larger than any reply a request here asks for, small enough that a wrong URL cannot exhaust memory. */
export const AI_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface AiHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface AiHttpOptions {
  networkProfile: NetworkProfile | null;
  timeoutMs: number;
  /** The job's signal; aborting it cancels the request. */
  signal?: AbortSignal;
}

export interface AiHttpResponse {
  status: number;
  headers: Headers;
  text: string;
  durationMs: number;
}

/** A request that got no usable HTTP answer: the failure code says why in plain words. */
export class AiNetworkError extends Error {
  constructor(
    readonly failure: AiFailureCode,
    message: string,
    readonly extra: { location?: string; aborted?: boolean } = {},
  ) {
    super(message);
    this.name = 'AiNetworkError';
  }
}

const TLS_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_UNTRUSTED',
]);

/**
 * One request to a provider, under the rules for an admin-typed URL: private addresses are
 * allowed, because local runners and proxies live on `localhost` or the LAN; link-local and cloud
 * metadata addresses are refused on the address actually connected to, so a name that later points
 * there is refused too; redirects are not followed; the body is capped; the connection's timeout
 * and the job's signal both apply.
 */
export async function aiHttp(request: AiHttpRequest, options: AiHttpOptions): Promise<AiHttpResponse> {
  const started = Date.now();
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  let response: Response;
  try {
    response = await safeFetch(
      request.url,
      { method: request.method, headers: request.headers, body: request.body, redirect: 'manual', signal },
      { allowPrivate: true, blockLinkLocal: true, pinResolvedAddress: true, profile: options.networkProfile },
    );
  } catch (err) {
    throw classify(err, options.signal);
  }

  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => undefined);
    const location = response.headers.get('location') ?? '';
    throw new AiNetworkError('redirect', location ? `The provider redirected to ${location}` : 'The provider answered with a redirect', { location });
  }

  try {
    const text = await readBoundedText(response, AI_MAX_RESPONSE_BYTES);
    return { status: response.status, headers: response.headers, text, durationMs: Date.now() - started };
  } catch (err) {
    if (err instanceof ResponseTooLargeError) {
      throw new AiNetworkError('provider-error', 'The provider sent more than 8 MB');
    }
    throw classify(err, options.signal);
  }
}

function classify(err: unknown, jobSignal?: AbortSignal): AiNetworkError {
  if (err instanceof AiNetworkError) return err;
  if (jobSignal?.aborted) return new AiNetworkError('timeout', 'The request was cancelled', { aborted: true });

  const chain = causes(err);
  if (chain.some((entry) => entry instanceof LinkLocalAddressException)) {
    return new AiNetworkError('blocked-address', 'This address is link-local or a cloud metadata service, which is never allowed');
  }
  if (chain.some((entry) => entry instanceof PrivateAddressException)) {
    return new AiNetworkError('blocked-address', 'This address is not allowed');
  }
  if (chain.some((entry) => entry instanceof RemoteHostResolutionException)) {
    return new AiNetworkError('unreachable', 'The host name could not be found');
  }
  if (chain.some((entry) => entry instanceof BadRequestException)) {
    return new AiNetworkError('invalid-url', chain.find((entry): entry is Error => entry instanceof Error)?.message ?? 'Invalid URL');
  }
  if (chain.some((entry) => entry instanceof Error && (entry.name === 'TimeoutError' || entry.name === 'AbortError'))) {
    return new AiNetworkError('timeout', 'The provider did not answer in time');
  }
  const code = chain.map((entry) => (entry as NodeJS.ErrnoException | undefined)?.code).find((value): value is string => typeof value === 'string');
  if (code && (TLS_ERROR_CODES.has(code) || code.startsWith('ERR_SSL') || code.startsWith('ERR_TLS'))) {
    return new AiNetworkError('tls', `The provider's certificate was not accepted (${code})`);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new AiNetworkError('unreachable', 'The host name could not be found');
  if (code === 'ECONNREFUSED') return new AiNetworkError('unreachable', 'Nothing is listening at this address and port');
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return new AiNetworkError('timeout', 'The provider did not answer in time');
  const message = chain.find((entry): entry is Error => entry instanceof Error)?.message ?? String(err);
  return new AiNetworkError('unreachable', message);
}

function causes(err: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current = err; current !== undefined && current !== null && chain.length < 5; current = (current as { cause?: unknown }).cause) {
    chain.push(current);
  }
  return chain;
}

/** `aiHttp` as a provider, so the client and the admin service can be tested against a stub. */
@Injectable()
export class AiHttpService {
  send(request: AiHttpRequest, options: AiHttpOptions): Promise<AiHttpResponse> {
    return aiHttp(request, options);
  }
}
