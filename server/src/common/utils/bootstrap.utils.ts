import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingHttpHeaders } from 'http';
import { Readable } from 'stream';

const DEFAULT_TRUST_PROXY = 'loopback,linklocal,uniquelocal';
const EMPTY_JSON_BODY = '{}';
const BODY_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);
// Matches @fastify/helmet's default Strict-Transport-Security max-age (1 year).
const HSTS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const HSTS_HEADER_VALUE = `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`;

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
const DICTIONARY_CONNECT_SRC = ['https://api.dictionaryapi.dev', 'https://*.wiktionary.org'];
const TRANSLATE_CONNECT_SRC = 'https://translate.googleapis.com';

export function buildCspDirectives(options: CspOptions = {}) {
  const { allowCloudflareInsights = false } = options;

  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...(allowCloudflareInsights ? [CLOUDFLARE_INSIGHTS_SCRIPT_SRC] : [])];
  const connectSrc = [
    "'self'",
    'ws:',
    'wss:',
    'https://cdn.jsdelivr.net',
    ...DICTIONARY_CONNECT_SRC,
    TRANSLATE_CONNECT_SRC,
    ...(allowCloudflareInsights ? [CLOUDFLARE_INSIGHTS_CONNECT_SRC] : []),
  ];

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

export function buildHelmetOptions(options: CspOptions = {}) {
  return {
    crossOriginOpenerPolicy: false,
    // Helmet sends HSTS over plain HTTP by default. The conditional hook adds it only for HTTPS.
    hsts: false,
    contentSecurityPolicy: {
      directives: buildCspDirectives(options),
    },
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
  return Readable.from([Buffer.from(EMPTY_JSON_BODY)]);
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

// Sending Strict-Transport-Security over a plain HTTP connection is harmful: browsers cache the
// directive per-hostname and force HTTPS for that host (and, with includeSubDomains, its subdomains)
// for up to a year, breaking access to BookOrbit and any other unrelated service on the same host
// when it isn't actually served over TLS. Only emit the header for requests that are genuinely
// secure, i.e. terminated over TLS directly or forwarded by a trusted proxy (see `request.protocol`,
// which already honours the app's `TRUST_PROXY` setting).
export function isSecureProtocol(protocol: string | undefined): boolean {
  return protocol === 'https';
}

export function applyConditionalHsts(request: Pick<FastifyRequest, 'protocol'>, reply: Pick<FastifyReply, 'header'>): void {
  if (isSecureProtocol(request.protocol)) {
    reply.header('Strict-Transport-Security', HSTS_HEADER_VALUE);
  }
}

export function registerConditionalHsts(fastify: FastifyInstance): void {
  fastify.addHook('onSend', (request, reply, payload, done) => {
    applyConditionalHsts(request, reply);
    done(null, payload);
  });
}
