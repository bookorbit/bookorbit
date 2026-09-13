/**
 * How the server should reach one configured source, where the default path does not work.
 *
 * Operator configuration, never something a plugin or an adapter chooses for itself: an adapter
 * asks for a URL and the host decides how to get there. That split is what keeps the containment
 * check meaningful, because the address actually connected to is still checked against the same
 * private-address policy whichever resolver or proxy produced it.
 */
export interface NetworkProfile {
  /**
   * DNS servers to use instead of the system resolver, as plain addresses. For a source whose
   * domain the host's own resolver refuses, or filters.
   */
  resolvers?: string[];
  /**
   * Egress through an HTTP proxy, as `http://host:port` with optional credentials. SOCKS is not
   * supported: it needs a different dispatcher, and a proxy container that speaks HTTP is the
   * common self-hosted shape.
   */
  proxyUrl?: string;
}

/** Nothing configured is the normal case, and must cost nothing at all. */
export function hasNetworkProfile(profile: NetworkProfile | null | undefined): boolean {
  return Boolean(profile && ((profile.resolvers && profile.resolvers.length > 0) || profile.proxyUrl));
}
