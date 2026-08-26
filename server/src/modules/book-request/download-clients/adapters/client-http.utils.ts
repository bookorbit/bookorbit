import { BadRequestException } from '@nestjs/common';

import { readBoundedText, ResponseTooLargeError } from '../../../../common/utils/bounded-response';

/** Every adapter talks to somebody else's daemon over the network, so none of them may hang. */
const CLIENT_REQUEST_TIMEOUT_MS = 20_000;

/**
 * How much of a daemon's answer BookOrbit is willing to hold in memory.
 *
 * The largest honest response any adapter asks for is a torrent listing, and even a client holding
 * tens of thousands of torrents answers that in single-digit megabytes; the poll is also batched,
 * so no single call sees the whole queue. What this bounds is the dishonest case: a daemon behind
 * a captive portal answering every call with a page, or a compromised one streaming forever, both
 * of which `response.json()` would read to the end whatever its size.
 */
const MAX_CLIENT_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * `new URL('/api/v2/...', base)` throws away any path the base carries, which silently breaks
 * every deployment where the client sits behind a reverse proxy at a subpath. Join under the
 * base's own path instead.
 */
export function endpointUrl(base: URL, path: string): URL {
  const prefix = base.pathname.replace(/\/+$/, '');
  const target = new URL(base.href);
  const [pathname, search] = path.split('?');
  target.pathname = `${prefix}${pathname}`;
  target.search = search ?? '';
  target.hash = '';
  return target;
}

/**
 * A timeout and a refusal both have to reach the operator as something they can act on, and
 * `fetch` reports them as the same opaque `TypeError`. `label` is the client's own name so the
 * settings form says which daemon went quiet when several are configured.
 */
export async function fetchClient(url: URL, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BadRequestException(`${label} did not answer in time`);
    }
    throw new BadRequestException(`Could not reach ${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `Authorization` header for a client that authenticates per request rather than holding a
 * session. Omitted entirely when neither half is set, since a client with authentication switched
 * off answers an empty Basic header with a 401.
 */
export function basicAuthHeader(username: string | null, password: string | null): Record<string, string> {
  if (!username && !password) return {};
  return { Authorization: `Basic ${Buffer.from(`${username ?? ''}:${password ?? ''}`).toString('base64')}` };
}

/** A daemon's answer as text, bounded. `label` is the client's own name, for the operator. */
export async function readClientText(response: Response, label: string): Promise<string> {
  try {
    return await readBoundedText(response, MAX_CLIENT_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof ResponseTooLargeError) throw new BadRequestException(`${label} answered with more data than BookOrbit will read`);
    throw error;
  }
}

/**
 * The same, parsed. `response.json()` is deliberately not used: it reads the whole body first and
 * only then decides it was not JSON, which is exactly the read this bounds.
 */
export async function readClientJson<T>(response: Response, label: string): Promise<T> {
  const body = await readClientText(response, label);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new BadRequestException(`${label} answered with something that is not JSON`);
  }
}
