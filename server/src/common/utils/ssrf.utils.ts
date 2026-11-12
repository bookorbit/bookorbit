import { lookup } from 'dns/promises';
import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

export class PrivateAddressException extends BadRequestException {
  constructor(message = 'URL resolves to a private or local address') {
    super(message);
  }
}

/** Link-local and cloud metadata addresses, refused even where private ones are allowed. */
export class LinkLocalAddressException extends PrivateAddressException {
  constructor() {
    super('URL resolves to a link-local or cloud metadata address');
  }
}

export class RemoteHostResolutionException extends BadRequestException {
  constructor() {
    super('Unable to resolve URL host');
  }
}

export interface SafeRemoteHostOptions {
  allowLocal?: boolean;
  allowPrivate?: boolean;
  /**
   * Refuse link-local and cloud metadata addresses whatever else is allowed. For a caller that
   * allows private addresses but holds a server secret, which must never be one URL away from the
   * metadata service.
   */
  blockLinkLocal?: boolean;
}

export async function ensureSafeUrl(rawUrl: string, options?: SafeRemoteHostOptions): Promise<URL> {
  const candidate = rawUrl.trim();
  if (!candidate) throw new BadRequestException('Invalid URL');

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BadRequestException('Invalid URL');
  }

  if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
    throw new BadRequestException('URL must use http or https');
  }

  await ensureSafeRemoteHost(parsed.hostname, options);
  return parsed;
}

export async function ensureSafeRemoteHost(hostname: string, options?: SafeRemoteHostOptions): Promise<void> {
  const normalizedHost = hostname.trim().toLowerCase();
  if (!normalizedHost) throw new BadRequestException('URL host is required');

  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost') || normalizedHost.endsWith('.local')) {
    if (!options?.allowLocal && !options?.allowPrivate) {
      throw new PrivateAddressException();
    }
    return; // explicitly local host, allowed when local/private override is enabled
  }

  // URL.hostname wraps IPv6 in brackets (e.g. [::1]); strip them for isIP/range checks
  const bareHost = normalizedHost.startsWith('[') && normalizedHost.endsWith(']') ? normalizedHost.slice(1, -1) : normalizedHost;

  const ipFamily = isIP(bareHost);
  if (ipFamily > 0) {
    if (options?.blockLinkLocal && isLinkLocalOrMetadataAddress(bareHost)) {
      throw new LinkLocalAddressException();
    }
    if (isPrivateOrLocalAddress(bareHost) && !options?.allowPrivate) {
      throw new PrivateAddressException();
    }
    return;
  }

  let resolved: any[];
  try {
    resolved = await lookup(normalizedHost, { all: true, verbatim: true });
  } catch {
    throw new RemoteHostResolutionException();
  }

  if (resolved.length === 0) throw new RemoteHostResolutionException();
  if (options?.blockLinkLocal && resolved.some((entry) => isLinkLocalOrMetadataAddress(entry.address))) {
    throw new LinkLocalAddressException();
  }
  if (resolved.some((entry) => isPrivateOrLocalAddress(entry.address)) && !options?.allowPrivate) {
    throw new PrivateAddressException();
  }
}

/** Exported so the one lookup a connection actually uses can apply the same policy. */
export function isPrivateOrLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedV4Prefix = '::ffff:';
  const maybeV4 = normalized.startsWith(mappedV4Prefix) ? normalized.slice(mappedV4Prefix.length) : normalized;
  const family = isIP(maybeV4);

  if (family === 4) {
    return isPrivateOrLocalV4(maybeV4);
  }

  if (family === 6) {
    return (
      maybeV4 === '::1' ||
      maybeV4 === '::' ||
      maybeV4.startsWith('fc') ||
      maybeV4.startsWith('fd') ||
      maybeV4.startsWith('fe8') ||
      maybeV4.startsWith('fe9') ||
      maybeV4.startsWith('fea') ||
      maybeV4.startsWith('feb')
    );
  }

  return true;
}

/** `169.254.0.0/16`, `fe80::/10` and `fd00:ec2::254`, including IPv4-mapped forms. */
export function isLinkLocalOrMetadataAddress(address: string): boolean {
  const normalized = address
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  const v4 = mapped ? mapped[1] : normalized;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 169 && b === 254;
  }
  if (isIP(normalized) !== 6) return false;
  const groups = expandIpv6(normalized);
  if (!groups) return true;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // IPv4-mapped written in hex (::ffff:a9fe:a9fe).
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff && groups[6] >> 8 === 169 && (groups[6] & 0xff) === 254) {
    return true;
  }
  return groups.join(':') === [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254].join(':');
}

function expandIpv6(address: string): number[] | null {
  let text = address;
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4Tail) {
    const [a, b, c, d] = v4Tail[1].split('.').map(Number);
    text = `${text.slice(0, -v4Tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (text.includes('::') ? missing < 0 : missing !== 0) return null;
  const groups = [...headGroups, ...Array<string>(text.includes('::') ? missing : 0).fill('0'), ...tailGroups].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function isPrivateOrLocalV4(address: string): boolean {
  const octets = address.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 0) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  return octets[0] >= 224;
}
