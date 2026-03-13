import { Injectable, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

const KOBO_API_BASE = 'https://storeapi.kobo.com';

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

@Injectable()
export class KoboProxyService {
  private readonly logger = new Logger(KoboProxyService.name);

  async forward(req: FastifyRequest, reply: FastifyReply, deviceToken: string) {
    const rawUrl = req.url;
    const prefix = `/api/v1/kobo/${deviceToken}`;
    const koboPath = rawUrl.startsWith(prefix) ? rawUrl.slice(prefix.length) : rawUrl;

    const targetUrl = `${KOBO_API_BASE}${koboPath}`;

    const headers: Record<string, string> = {};
    for (const key of FORWARD_HEADERS) {
      const val = req.headers[key];
      if (val) headers[key] = Array.isArray(val) ? val[0] : val;
    }

    try {
      let body: string | undefined;
      if (!['GET', 'HEAD'].includes(req.method) && req.body != null) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }

      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
      });

      reply.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!['transfer-encoding', 'connection', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
          reply.header(key, value);
        }
      });

      const responseBody = await upstream.arrayBuffer();
      reply.send(Buffer.from(responseBody));
    } catch (err) {
      this.logger.warn(`Proxy failed for ${targetUrl}: ${(err as Error).message}`);
      reply.status(502).send({ message: 'Upstream Kobo API unavailable' });
    }
  }
}
