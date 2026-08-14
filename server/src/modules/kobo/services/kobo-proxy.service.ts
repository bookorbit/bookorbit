import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

const KOBO_API_BASE = 'https://storeapi.kobo.com';
const KOBO_API_HOSTNAME = 'storeapi.kobo.com';

const FORWARD_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'user-agent',
  'x-kobo-affiliatename',
  'x-kobo-appversion',
  'x-kobo-deviceid',
  'x-kobo-devicemodel',
  'x-kobo-deviceos',
  'x-kobo-deviceosversion',
  'x-kobo-platformid',
  'x-kobo-synctokenversion',
];

const HOP_BY_HOP_HEADERS = ['transfer-encoding', 'connection', 'content-encoding', 'content-length'];

export type KoboProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type KoboProxyRequestOptions = {
  extraHeaders?: Record<string, string>;
  /** Drops headers FORWARD_HEADERS would otherwise copy from the device request. */
  omitHeaders?: string[];
  timeoutMs?: number;
};

@Injectable()
export class KoboProxyService {
  private readonly logger = new Logger(KoboProxyService.name);

  /** Calls Kobo with the device's own credentials and hands the response back instead of piping it. */
  async request(req: FastifyRequest, deviceToken: string, options: KoboProxyRequestOptions = {}): Promise<KoboProxyResponse> {
    const targetUrl = this.resolveTargetUrl(req, deviceToken);

    const headers: Record<string, string> = {};
    for (const key of FORWARD_HEADERS) {
      const val = req.headers[key];
      if (val) headers[key] = Array.isArray(val) ? val[0] : val;
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

  /** Relays an upstream response to the device, dropping the headers that must not be forwarded. */
  sendUpstream(reply: FastifyReply, response: KoboProxyResponse): void {
    reply.status(response.status);
    for (const [key, value] of Object.entries(response.headers)) {
      if (!HOP_BY_HOP_HEADERS.includes(key)) {
        reply.header(key, value);
      }
    }
    reply.send(response.body);
  }

  async forward(req: FastifyRequest, reply: FastifyReply, deviceToken: string) {
    const targetUrl = this.resolveTargetUrl(req, deviceToken);

    try {
      this.sendUpstream(reply, await this.request(req, deviceToken));
    } catch (err) {
      this.logger.warn(`Proxy failed for ${targetUrl}: ${(err as Error).message}`);
      reply.status(502).send({ message: 'Upstream Kobo API unavailable' });
    }
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
