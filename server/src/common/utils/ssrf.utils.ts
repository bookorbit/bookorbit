import { lookup } from 'dns/promises';
import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

export interface SafeRemoteHostOptions {
  allowLocal?: boolean;
  allowPrivate?: boolean;
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
      throw new BadRequestException('URL host is not allowed');
    }
    return; // explicitly local host, allowed when local/private override is enabled
  }

  // URL.hostname wraps IPv6 in brackets (e.g. [::1]); strip them for isIP/range checks
  const bareHost = normalizedHost.startsWith('[') && normalizedHost.endsWith(']') ? normalizedHost.slice(1, -1) : normalizedHost;

  const ipFamily = isIP(bareHost);
  if (ipFamily > 0) {
    if (isPrivateOrLocalAddress(bareHost) && !options?.allowPrivate) {
      throw new BadRequestException('URL host is not allowed');
    }
    return;
  }

  let resolved: any[];
  try {
    resolved = await lookup(normalizedHost, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException('Unable to resolve URL host');
  }

  if (resolved.length === 0) throw new BadRequestException('Unable to resolve URL host');
  if (resolved.some((entry) => isPrivateOrLocalAddress(entry.address)) && !options?.allowPrivate) {
    throw new BadRequestException('URL host is not allowed');
  }
}

function isPrivateOrLocalAddress(address: string): boolean {
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
