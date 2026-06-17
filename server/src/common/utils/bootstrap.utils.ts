import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import type { IncomingHttpHeaders } from 'http';
import { Readable } from 'stream';

const DEFAULT_TRUST_PROXY = 'loopback,linklocal,uniquelocal';
const EMPTY_JSON_BODY = '{}';
const BODY_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

export function parseTrustProxy(value: string | undefined): string | boolean | number {
  const raw = value?.trim();
  if (!raw) return DEFAULT_TRUST_PROXY;

  const normalized = raw.toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;

  const hopCount = Number(raw);
  if (Number.isInteger(hopCount) && hopCount >= 0) return hopCount;

  return raw;
}

export function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const raw = value?.trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  return fallback;
}

export interface CspOptions {
  allowCloudflareInsights?: boolean;
}

const CLOUDFLARE_INSIGHTS_SCRIPT_SRC = 'https://static.cloudflareinsights.com';
const CLOUDFLARE_INSIGHTS_CONNECT_SRC = 'https://cloudflareinsights.com';

export function buildCspDirectives(options: CspOptions = {}) {
  const { allowCloudflareInsights = false } = options;

  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...(allowCloudflareInsights ? [CLOUDFLARE_INSIGHTS_SCRIPT_SRC] : [])];
  const connectSrc = ["'self'", 'ws:', 'wss:', 'https://cdn.jsdelivr.net', ...(allowCloudflareInsights ? [CLOUDFLARE_INSIGHTS_CONNECT_SRC] : [])];

  return {
    defaultSrc: ["'self'"],
    scriptSrc,
    styleSrc: ["'self'", "'unsafe-inline'", 'blob:', 'https://fonts.googleapis.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc,
    mediaSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'data:', 'blob:', 'https://fonts.gstatic.com'],
    objectSrc: ["'none'"],
    frameSrc: ["'self'", 'blob:'],
    frameAncestors: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
    upgradeInsecureRequests: null,
  };
}

export function shouldInjectEmptyJsonBody(method: string, headers: IncomingHttpHeaders): boolean {
  const contentType = getHeaderValue(headers['content-type'])?.toLowerCase();
  if (!BODY_METHODS.has(method.toUpperCase()) || !contentType?.startsWith('application/json')) {
    return false;
  }

  const contentLength = getHeaderValue(headers['content-length'])?.trim();
  return contentLength === undefined || contentLength === '0';
}

export function buildEmptyJsonBodyStream(headers: IncomingHttpHeaders): Readable {
  headers['content-length'] = String(Buffer.byteLength(EMPTY_JSON_BODY));
  return Readable.from([EMPTY_JSON_BODY]);
}

export function registerEmptyBodyContentTypeParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser<string>('*', { parseAs: 'string' }, (request, body, done) => {
    if (BODY_METHODS.has(request.method.toUpperCase()) && body.length === 0) {
      done(null, {});
      return;
    }

    done(new UnsupportedMediaTypeException('Unsupported Media Type'));
  });
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
