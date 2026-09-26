import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { BlockList, isIP } from 'net';
import type { LookupFunction } from 'net';
import { Agent } from 'undici';

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2001::', 32],
  ['2002::', 16],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6');
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

@Injectable()
export class PodcastUrlSecurityService {
  async fetch(value: string | URL, init: RequestInit = {}, maxRedirects = 5): Promise<{ response: Response; finalUrl: URL }> {
    let currentUrl = parsePodcastUrl(value);
    for (let redirectCount = 0; ; redirectCount++) {
      const addresses = await this.resolvePublicAddresses(currentUrl);
      const response = await fetchPinned(currentUrl, init, addresses);
      if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: currentUrl };

      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new BadGatewayException('Podcast server returned an invalid redirect');
      if (redirectCount >= maxRedirects) throw new BadGatewayException('Podcast server returned too many redirects');
      currentUrl = parsePodcastUrl(new URL(location, currentUrl));
    }
  }

  async assertPublicDestination(url: URL): Promise<void> {
    await this.resolvePublicAddresses(url);
  }

  private async resolvePublicAddresses(url: URL): Promise<PublicAddress[]> {
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new BadRequestException('Private podcast destinations are not allowed');
    }

    let addresses: PublicAddress[];
    const family = isIP(hostname);
    if (family) {
      addresses = [{ address: hostname, family: family as 4 | 6 }];
    } else {
      try {
        const resolved = await lookup(hostname, { all: true, verbatim: true });
        addresses = resolved.flatMap(({ address, family: resolvedFamily }) =>
          resolvedFamily === 4 || resolvedFamily === 6 ? [{ address, family: resolvedFamily }] : [],
        );
      } catch {
        throw new BadGatewayException('Podcast destination could not be resolved');
      }
    }
    if (addresses.length === 0) throw new BadGatewayException('Podcast destination could not be resolved');
    if (addresses.some(({ address, family: addressFamily }) => isBlockedAddress(address, addressFamily))) {
      throw new BadRequestException('Private podcast destinations are not allowed');
    }
    return addresses;
  }
}

interface PublicAddress {
  address: string;
  family: 4 | 6;
}

export function parsePodcastUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value.trim());
  } catch {
    throw new BadRequestException('Podcast URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new BadRequestException('Podcast URL must use HTTP or HTTPS');
  if (url.username || url.password) throw new BadRequestException('Podcast URL credentials are not supported');
  return url;
}

function isBlockedAddress(address: string, family: number): boolean {
  if (family === 4) return blockedIpv4Addresses.check(address, 'ipv4');
  if (family !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  return mapped ? blockedIpv4Addresses.check(mapped, 'ipv4') : blockedIpv6Addresses.check(address, 'ipv6');
}

async function fetchPinned(url: URL, init: RequestInit, addresses: PublicAddress[]): Promise<Response> {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', dispatcher } as RequestInit & { dispatcher: Agent });
    if (!response.body) {
      await dispatcher.close();
      return response;
    }
    return wrapResponseBody(response, () => dispatcher.close());
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

function pinnedLookup(addresses: PublicAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = typeof options === 'object' ? options.family : 0;
    const eligible = family === 4 || family === 6 ? addresses.filter((address) => address.family === family) : addresses;
    const selected = eligible.length > 0 ? eligible : addresses;
    if (typeof options === 'object' && options.all) {
      callback(null, selected);
      return;
    }
    const first = selected[0]!;
    callback(null, first.address, first.family);
  };
}

function wrapResponseBody(response: Response, close: () => Promise<void>): Response {
  const reader = response.body!.getReader();
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    await close();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          await cleanup();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
        await cleanup();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await cleanup();
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
