import { Resolver, lookup } from 'node:dns/promises';
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { NetworkProfile } from '@bookorbit/types';
import { hasNetworkProfile } from '@bookorbit/types';

import { PrivateAddressException, ensureSafeUrl, isPrivateOrLocalAddress, type SafeRemoteHostOptions } from './ssrf.utils';

export interface SafeFetchOptions extends SafeRemoteHostOptions {
  /** How to reach this source, where the default path does not work. */
  profile?: NetworkProfile | null;
  signal?: AbortSignal;
  /**
   * Close the resolve-twice window described below, for a caller whose URL came from a tracker
   * rather than from an operator. Costs an undici dispatcher on a path that would otherwise use
   * the global fetch, which is why it is asked for rather than assumed.
   */
  pinResolvedAddress?: boolean;
}

/**
 * Agents are pooled per profile so ordinary connection reuse still happens. Keyed on the profile
 * itself rather than on a host, because that is what decides the network path.
 */
const dispatchers = new Map<string, Dispatcher>();

/**
 * Fetch a URL the way BookOrbit is allowed to.
 *
 * Two paths, and they do not offer the same guarantee.
 *
 * With a profile, **the address checked is the address connected to**: the policy runs inside the
 * connect lookup, so there is one resolution and the connection uses exactly what it approved.
 *
 * Without one - the overwhelmingly common case - the request goes to the global `fetch` and the
 * only check is the `ensureSafeUrl` pre-flight above. That resolves the host, approves it, and
 * then hands the URL to `fetch`, which resolves it again, so a name answering publicly on the
 * first lookup and privately on the second reaches the private host anyway. The window is left
 * open deliberately: closing it means routing every caller through an undici dispatcher, which
 * changes name resolution for all outbound traffic, and the callers whose URLs come from a
 * tracker rather than from an operator are the narrow case rather than the rule.
 *
 * Those narrow callers ask for `pinResolvedAddress`, which takes the dispatcher path with no
 * profile configured and so gets the same one-resolution guarantee an operator profile gets.
 *
 * A profile changes only *how* the address is found and which egress carries the request. It never
 * relaxes what is allowed: whatever the resolver returns still has to pass the same policy.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, options: SafeFetchOptions = {}): Promise<Response> {
  // A pre-flight so a bad host fails with a clear message rather than as a socket error, and so
  // a caller with no profile behaves exactly as it did before this existed.
  const url = await ensureSafeUrl(rawUrl, options);

  if (!hasNetworkProfile(options.profile) && !options.pinResolvedAddress) {
    return fetch(url, init);
  }

  const dispatcher = dispatcherFor(options);
  // undici's own fetch, not the global one: the global fetch rejects a dispatcher built from this
  // package, because Node bundles a separate copy of undici and type-checks against its own.
  return undiciFetch(url.href, { ...(init as Record<string, unknown>), dispatcher } as never) as unknown as Promise<Response>;
}

/** Drop pooled agents, so a settings change is not served by a connection opened under the old one. */
export function forgetDispatchers(): void {
  for (const dispatcher of dispatchers.values()) void dispatcher.close();
  dispatchers.clear();
}

function dispatcherFor(options: SafeFetchOptions): Dispatcher {
  // An empty profile is a real case here: `pinResolvedAddress` wants the checked lookup without
  // asking for a different resolver or an egress, and that pools as its own agent.
  const profile = options.profile ?? {};
  const key = JSON.stringify({ r: profile.resolvers ?? [], p: profile.proxyUrl ?? '', a: Boolean(options.allowPrivate) });
  const existing = dispatchers.get(key);
  if (existing) return existing;

  const connect = { lookup: buildLookup(profile, options) };
  const dispatcher: Dispatcher = profile.proxyUrl ? new ProxyAgent({ uri: profile.proxyUrl, connect }) : new Agent({ connect });

  dispatchers.set(key, dispatcher);
  return dispatcher;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void;

/**
 * The one resolution the connection actually uses, checked before it is handed back.
 *
 * A proxy resolves the destination itself, so when one is configured the name never reaches this
 * lookup: only the proxy's own host does. That is the honest trade of proxying, and it is why the
 * proxy address is validated when the profile is saved rather than only here.
 */
function buildLookup(profile: NetworkProfile, options: SafeFetchOptions) {
  return (hostname: string, _opts: unknown, callback: LookupCallback): void => {
    void resolveWith(profile, hostname)
      .then((addresses) => {
        if (addresses.length === 0) {
          callback(Object.assign(new Error(`Unable to resolve ${hostname}`), { code: 'ENOTFOUND' }), []);
          return;
        }
        if (!options.allowPrivate && addresses.some((entry) => isPrivateOrLocalAddress(entry.address))) {
          callback(Object.assign(new PrivateAddressException(), { code: 'EACCES' }) as NodeJS.ErrnoException, []);
          return;
        }
        callback(null, addresses);
      })
      .catch((error: unknown) => {
        callback(Object.assign(error instanceof Error ? error : new Error(String(error)), { code: 'ENOTFOUND' }), []);
      });
  };
}

async function resolveWith(profile: NetworkProfile, hostname: string): Promise<Array<{ address: string; family: number }>> {
  // With no resolver configured, the system one, which is what the request would have used anyway.
  // `Resolver` asks a DNS server directly and so never sees a hosts-file or mDNS name, which is
  // how a LAN source resolves; it is only correct where an operator asked for a specific server.
  if (!profile.resolvers || profile.resolvers.length === 0) {
    return systemLookup(hostname);
  }

  const resolver = new Resolver();
  resolver.setServers(profile.resolvers);

  // Both families, because a source may publish only one and a failure of the other is not an
  // error. Rejecting only when neither answered keeps a v4-only host reachable.
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  const addresses = [
    ...(v4.status === 'fulfilled' ? v4.value.map((address) => ({ address, family: 4 })) : []),
    ...(v6.status === 'fulfilled' ? v6.value.map((address) => ({ address, family: 6 })) : []),
  ];
  if (addresses.length === 0 && v4.status === 'rejected') throw v4.reason as Error;
  return addresses;
}

async function systemLookup(hostname: string): Promise<Array<{ address: string; family: number }>> {
  const resolved = await lookup(hostname, { all: true, verbatim: true });
  return resolved.map((entry) => ({ address: entry.address, family: entry.family }));
}
