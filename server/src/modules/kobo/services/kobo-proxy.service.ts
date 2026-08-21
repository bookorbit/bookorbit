import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { decodeSyncToken } from './kobo-sync-token';

const KOBO_API_BASE = 'https://storeapi.kobo.com';
const KOBO_API_HOSTNAME = 'storeapi.kobo.com';

// Headers that must never be forwarded. Connection-specific headers are defined by RFC 7230 as
// scoped to a single hop and reset by every proxy, and `host` would otherwise point Kobo at the
// BookOrbit host that the device just spoke to. Everything else the device sends (including
// `x-kobo-userkey`, which authorizes most Kobo API calls, and `x-kobo-synctoken`, which carries
// the upstream cursor) is forwarded, with two escape hatches callers can use:
//   * `extraHeaders` overrides a forwarded value (the sync-token-aware entry points use this to
//     hand Kobo its own cursor instead of the BookOrbit composite).
//   * `omitHeaders` strips a forwarded header (used to drop our composite when we have no Kobo
//     cursor to substitute).
const DROP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
]);

export type KoboProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type KoboProxyRequestOptions = {
  extraHeaders?: Record<string, string>;
  /** Drops headers the device would otherwise copy. */
  omitHeaders?: string[];
  timeoutMs?: number;
};

/**
 * Reads the `Connection` header from a header bag, splits it on commas, lowercases each field
 * name, and returns the result. RFC 7230 §6.1 says every field listed in `Connection` is
 * hop-specific: a proxy must remove those fields before forwarding the message.
 */
function readConnectionFieldNames(headers: Record<string, string | string[] | undefined>): string[] {
  const raw = headers['connection'];
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .flatMap((v) => v.split(','))
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
}

@Injectable()
export class KoboProxyService {
  private readonly logger = new Logger(KoboProxyService.name);

  /** Calls Kobo with the device's own credentials and hands the response back instead of piping it. */
  async request(req: FastifyRequest, deviceToken: string, options: KoboProxyRequestOptions = {}): Promise<KoboProxyResponse> {
    const targetUrl = this.resolveTargetUrl(req, deviceToken);

    // Fastify lowercases header keys, but defensive: lowercase the lookup keys too.
    const sourceHeaders = req.headers as Record<string, string | string[] | undefined>;
    const connectionFields = new Set(readConnectionFieldNames(sourceHeaders));
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(sourceHeaders)) {
      if (value === undefined) continue;
      const lowerKey = key.toLowerCase();
      if (DROP_HEADERS.has(lowerKey)) continue;
      if (connectionFields.has(lowerKey)) continue;
      headers[lowerKey] = Array.isArray(value) ? (value[0] ?? '') : value;
    }

    for (const key of options.omitHeaders ?? []) {
      delete headers[key.toLowerCase()];
    }
    for (const [key, value] of Object.entries(options.extraHeaders ?? {})) {
      headers[key.toLowerCase()] = value;
    }

    let body: string | undefined;
    if (!['GET', 'HEAD'].includes(req.method) && req.body != null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    // codeql[js/request-forgery] - hostname validated by buildTargetUrl() to KOBO_API_HOSTNAME
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    });

    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    return { status: upstream.status, headers: responseHeaders, body: Buffer.from(await upstream.arrayBuffer()) };
  }

  /**
   * Relays a request to Kobo, dropping the connection-specific headers and replacing the device's
   * BookOrbit composite sync token with the Kobo cursor it carries. Kobo's API does not understand
   * `PX.<base64>` and treats it as a fresh cursor, so a borrow call that uses it lands Kobo in a
   * state where the device has an entitlement BookOrbit never sees on this iteration.
   */
  async forward(req: FastifyRequest, reply: FastifyReply, deviceToken: string): Promise<void> {
    const startedAt = Date.now();
    const targetUrl = this.resolveTargetUrl(req, deviceToken);
    const deviceId = (req as unknown as { koboDevice?: { deviceId: number } }).koboDevice?.deviceId;

    this.logger.debug(`[kobo.proxy] [start] deviceId=${deviceId ?? 'unknown'} - upstream Kobo relay started`);

    const syncTokenHeader = this.readSyncTokenHeader(req);
    const koboCursor = syncTokenHeader ? decodeSyncToken(syncTokenHeader).koboSyncToken : undefined;

    try {
      const response = await this.request(req, deviceToken, {
        ...(syncTokenHeader !== undefined
          ? koboCursor !== undefined
            ? { extraHeaders: { 'x-kobo-synctoken': koboCursor } }
            : { omitHeaders: ['x-kobo-synctoken'] }
          : {}),
      });
      this.sendUpstream(reply, response);
      this.logger.debug(
        `[kobo.proxy] [end] deviceId=${deviceId ?? 'unknown'} durationMs=${Date.now() - startedAt} upstreamStatus=${response.status} - upstream Kobo relay completed`,
      );
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : 'unknown error');
      const sanitizedUrl = sanitizeLogValue(targetUrl);
      this.logger.warn(
        `[kobo.proxy] [fail] deviceId=${deviceId ?? 'unknown'} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" targetUrl="${sanitizedUrl}" - upstream Kobo relay failed`,
      );
      reply.status(502).send({ message: 'Upstream Kobo API unavailable' });
    }
  }

  /** Relays an upstream response to the device, dropping the headers that must not be forwarded. */
  sendUpstream(reply: FastifyReply, response: KoboProxyResponse): void {
    reply.status(response.status);
    const connectionFields = new Set(readConnectionFieldNames(response.headers));
    for (const [key, value] of Object.entries(response.headers)) {
      const lowerKey = key.toLowerCase();
      if (DROP_HEADERS.has(lowerKey)) continue;
      if (connectionFields.has(lowerKey)) continue;
      reply.header(lowerKey, value);
    }
    reply.send(response.body);
  }

  private readSyncTokenHeader(req: FastifyRequest): string | undefined {
    const raw = (req.headers as Record<string, string | string[] | undefined>)['x-kobo-synctoken'];
    if (raw === undefined) return undefined;
    return Array.isArray(raw) ? raw[0] : raw;
  }

  private resolveTargetUrl(req: FastifyRequest, deviceToken: string): string {
    const rawUrl = req.url;
    const prefix = `/api/v1/kobo/${deviceToken}`;
    const koboPath = rawUrl.startsWith(prefix) ? rawUrl.slice(prefix.length) : rawUrl;
    return this.buildTargetUrl(koboPath);
  }

  private buildTargetUrl(koboPath: string): string {
    let parsed: URL;
    try {
      parsed = new URL(koboPath, KOBO_API_BASE);
    } catch {
      throw new BadRequestException('Invalid proxy path');
    }
    if (parsed.hostname !== KOBO_API_HOSTNAME) {
      throw new BadRequestException('Invalid proxy path');
    }
    return parsed.toString();
  }
}
