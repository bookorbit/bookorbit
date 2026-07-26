import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import { request } from 'http';
import type { AddressInfo } from 'net';
import {
  parseBooleanEnv,
  parseTrustProxy,
  buildCspDirectives,
  buildHelmetOptions,
  buildEmptyJsonBodyStream,
  registerEmptyBodyContentTypeParser,
  shouldInjectEmptyJsonBody,
  isSecureProtocol,
  applyConditionalHsts,
  registerConditionalHsts,
} from './bootstrap.utils';

describe('parseBooleanEnv', () => {
  it('returns fallback when value is undefined', () => {
    expect(parseBooleanEnv(undefined)).toBe(false);
    expect(parseBooleanEnv(undefined, true)).toBe(true);
  });

  it('returns fallback when value is empty string', () => {
    expect(parseBooleanEnv('')).toBe(false);
    expect(parseBooleanEnv('', true)).toBe(true);
  });

  it('returns fallback when value is whitespace only', () => {
    expect(parseBooleanEnv('   ')).toBe(false);
    expect(parseBooleanEnv('   ', true)).toBe(true);
  });

  it.each(['false', 'FALSE', 'False', '0', 'no', 'NO', 'off', 'OFF'])('returns false for falsy string %s', (val) => {
    expect(parseBooleanEnv(val)).toBe(false);
    expect(parseBooleanEnv(val, true)).toBe(false);
  });

  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'ON'])('returns true for truthy string %s', (val) => {
    expect(parseBooleanEnv(val)).toBe(true);
    expect(parseBooleanEnv(val, false)).toBe(true);
  });

  it('returns fallback for unrecognised value', () => {
    expect(parseBooleanEnv('maybe')).toBe(false);
    expect(parseBooleanEnv('maybe', true)).toBe(true);
    expect(parseBooleanEnv('enabled')).toBe(false);
  });

  it('trims surrounding whitespace before evaluating', () => {
    expect(parseBooleanEnv('  true  ')).toBe(true);
    expect(parseBooleanEnv('  false  ')).toBe(false);
    expect(parseBooleanEnv('  1  ')).toBe(true);
    expect(parseBooleanEnv('  0  ')).toBe(false);
  });
});

describe('parseTrustProxy', () => {
  it('returns the default loopback string when value is undefined', () => {
    expect(parseTrustProxy(undefined)).toBe('loopback,linklocal,uniquelocal');
  });

  it('returns the default loopback string when value is empty string', () => {
    expect(parseTrustProxy('')).toBe('loopback,linklocal,uniquelocal');
  });

  it('returns the default loopback string when value is whitespace only', () => {
    expect(parseTrustProxy('   ')).toBe('loopback,linklocal,uniquelocal');
  });

  it.each(['false', '0', 'no', 'off'])('returns false for falsy string %s', (val) => {
    expect(parseTrustProxy(val)).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on'])('returns true for truthy string %s', (val) => {
    expect(parseTrustProxy(val)).toBe(true);
  });

  it('parses non-negative integer hop counts', () => {
    expect(parseTrustProxy('0')).toBe(false); // '0' is a falsy string, handled before hop-count check
    expect(parseTrustProxy('1')).toBe(true); // '1' is a truthy string
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('10')).toBe(10);
  });

  it('returns the raw string for arbitrary proxy values', () => {
    expect(parseTrustProxy('127.0.0.1')).toBe('127.0.0.1');
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });

  it('returns the raw string for decimal numbers (not valid integers)', () => {
    expect(parseTrustProxy('1.5')).toBe('1.5');
    expect(parseTrustProxy('2.9')).toBe('2.9');
  });

  it('returns the raw string for negative integers', () => {
    expect(parseTrustProxy('-1')).toBe('-1');
    expect(parseTrustProxy('-5')).toBe('-5');
  });

  it('trims surrounding whitespace before evaluating', () => {
    expect(parseTrustProxy('  true  ')).toBe(true);
    expect(parseTrustProxy('  false  ')).toBe(false);
    expect(parseTrustProxy('  127.0.0.1  ')).toBe('127.0.0.1');
  });
});

describe('buildCspDirectives', () => {
  it('returns directives with required sources when Cloudflare Insights is disabled', () => {
    const directives = buildCspDirectives({ allowCloudflareInsights: false });

    expect(directives.defaultSrc).toEqual(["'self'"]);
    expect(directives.scriptSrc).toContain("'self'");
    expect(directives.scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(directives.objectSrc).toEqual(["'none'"]);
    expect(directives.upgradeInsecureRequests).toBeNull();
  });

  it('uses defaults when called with no arguments', () => {
    const directives = buildCspDirectives();

    expect(directives.scriptSrc).toContain("'self'");
    expect(directives.scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(directives.connectSrc).not.toContain('https://cloudflareinsights.com');
  });

  describe('styleSrc', () => {
    it("includes 'self', 'unsafe-inline', blob:, and Google Fonts stylesheet domain", () => {
      const { styleSrc } = buildCspDirectives();

      expect(styleSrc).toContain("'self'");
      expect(styleSrc).toContain("'unsafe-inline'");
      expect(styleSrc).toContain('blob:');
      expect(styleSrc).toContain('https://fonts.googleapis.com');
    });
  });

  describe('fontSrc', () => {
    it("includes 'self', data:, blob:, and Google Fonts gstatic domain", () => {
      const { fontSrc } = buildCspDirectives();

      expect(fontSrc).toContain("'self'");
      expect(fontSrc).toContain('data:');
      expect(fontSrc).toContain('blob:');
      expect(fontSrc).toContain('https://fonts.gstatic.com');
    });
  });

  describe('workerSrc', () => {
    it("includes 'self' and blob: to allow PDF web workers", () => {
      const { workerSrc } = buildCspDirectives();

      expect(workerSrc).toContain("'self'");
      expect(workerSrc).toContain('blob:');
    });
  });

  describe('connectSrc', () => {
    it('always includes jsDelivr CDN for embedpdf stamps manifest', () => {
      const { connectSrc } = buildCspDirectives({ allowCloudflareInsights: false });

      expect(connectSrc).toContain("'self'");
      expect(connectSrc).toContain('ws:');
      expect(connectSrc).toContain('wss:');
      expect(connectSrc).toContain('https://cdn.jsdelivr.net');
    });

    it('does not include Cloudflare Insights connect endpoint when disabled', () => {
      const { connectSrc } = buildCspDirectives({ allowCloudflareInsights: false });

      expect(connectSrc).not.toContain('https://cloudflareinsights.com');
    });

    it('includes dictionary lookup endpoints used by the epub reader', () => {
      const { connectSrc } = buildCspDirectives();

      expect(connectSrc).toContain('https://api.dictionaryapi.dev');
      expect(connectSrc).toContain('https://*.wiktionary.org');
    });

    it('includes the Google Translate endpoint used by the epub reader regardless of Cloudflare Insights setting', () => {
      expect(buildCspDirectives({ allowCloudflareInsights: false }).connectSrc).toContain('https://translate.googleapis.com');
      expect(buildCspDirectives({ allowCloudflareInsights: true }).connectSrc).toContain('https://translate.googleapis.com');
      expect(buildCspDirectives().connectSrc).toContain('https://translate.googleapis.com');
    });
  });

  describe('scriptSrc with Cloudflare Insights', () => {
    it('adds Cloudflare Insights script domain when enabled', () => {
      const { scriptSrc } = buildCspDirectives({ allowCloudflareInsights: true });

      expect(scriptSrc).toContain("'self'");
      expect(scriptSrc).toContain("'wasm-unsafe-eval'");
      expect(scriptSrc).toContain('https://static.cloudflareinsights.com');
    });

    it('adds Cloudflare Insights connect domain when enabled', () => {
      const { connectSrc } = buildCspDirectives({ allowCloudflareInsights: true });

      expect(connectSrc).toContain('https://cdn.jsdelivr.net');
      expect(connectSrc).toContain('https://cloudflareinsights.com');
    });

    it('does not add Cloudflare domains when disabled', () => {
      const { scriptSrc, connectSrc } = buildCspDirectives({ allowCloudflareInsights: false });

      expect(scriptSrc).not.toContain('https://static.cloudflareinsights.com');
      expect(connectSrc).not.toContain('https://cloudflareinsights.com');
    });
  });

  describe('scriptSrc WASM', () => {
    it("always includes 'wasm-unsafe-eval' to allow WebAssembly compilation", () => {
      expect(buildCspDirectives({ allowCloudflareInsights: false }).scriptSrc).toContain("'wasm-unsafe-eval'");
      expect(buildCspDirectives({ allowCloudflareInsights: true }).scriptSrc).toContain("'wasm-unsafe-eval'");
    });
  });

  describe('static directives', () => {
    it('imgSrc allows self, data, blob, and https (for admin-configured OIDC provider icons)', () => {
      const { imgSrc } = buildCspDirectives();
      expect(imgSrc).toEqual(["'self'", 'data:', 'blob:', 'https:']);
    });

    it('imgSrc does not allow plain http to keep mixed-content protection', () => {
      const { imgSrc } = buildCspDirectives();
      expect(imgSrc).not.toContain('http:');
      expect(imgSrc).not.toContain('*');
    });

    it('mediaSrc allows self, data, and blob', () => {
      const { mediaSrc } = buildCspDirectives();
      expect(mediaSrc).toEqual(["'self'", 'data:', 'blob:']);
    });

    it('frameSrc allows self and blob', () => {
      const { frameSrc } = buildCspDirectives();
      expect(frameSrc).toEqual(["'self'", 'blob:']);
    });

    it('frameAncestors restricts to self only', () => {
      const { frameAncestors } = buildCspDirectives();
      expect(frameAncestors).toEqual(["'self'"]);
    });

    it('objectSrc is none', () => {
      const { objectSrc } = buildCspDirectives();
      expect(objectSrc).toEqual(["'none'"]);
    });

    it('upgradeInsecureRequests is null', () => {
      const { upgradeInsecureRequests } = buildCspDirectives();
      expect(upgradeInsecureRequests).toBeNull();
    });
  });

  describe('buildHelmetOptions (integration)', () => {
    it('emits a Content-Security-Policy header whose connect-src allows the Google Translate endpoint', async () => {
      await withCspApp(async (app) => {
        const response = await app.inject({ method: 'GET', url: '/ping' });

        const csp = response.headers['content-security-policy'];
        expect(csp).toBeDefined();

        const connectSrcDirective = String(csp)
          .split(';')
          .map((directive) => directive.trim())
          .find((directive) => directive.startsWith('connect-src'));

        expect(connectSrcDirective).toContain('https://translate.googleapis.com');
      });
    });
  });
});

describe('empty request body bootstrap handling', () => {
  it('identifies empty JSON body requests that need parser-safe replacement', () => {
    expect(shouldInjectEmptyJsonBody('POST', { 'content-type': 'application/json', 'content-length': '0' })).toBe(true);
    expect(shouldInjectEmptyJsonBody('DELETE', { 'content-type': 'application/json' })).toBe(true);
    expect(shouldInjectEmptyJsonBody('PATCH', { 'content-type': 'application/json; charset=utf-8', 'content-length': '0' })).toBe(true);
    expect(shouldInjectEmptyJsonBody('POST', { 'content-type': 'Application/JSON', 'content-length': ' 0 ' })).toBe(true);

    expect(shouldInjectEmptyJsonBody('GET', { 'content-type': 'application/json', 'content-length': '0' })).toBe(false);
    expect(shouldInjectEmptyJsonBody('POST', { 'content-type': 'text/plain', 'content-length': '0' })).toBe(false);
    expect(shouldInjectEmptyJsonBody('POST', { 'content-type': 'application/json', 'content-length': '9' })).toBe(false);
  });

  it('builds a parser-safe empty JSON stream with a matching content length', async () => {
    const headers = { 'content-length': '0' };
    const stream = buildEmptyJsonBodyStream(headers);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      expect(Buffer.isBuffer(chunk)).toBe(true);
      chunks.push(Buffer.from(chunk));
    }

    expect(headers['content-length']).toBe('2');
    expect(Buffer.concat(chunks).toString('utf8')).toBe('{}');
  });

  it('accepts empty unsupported content types as an empty object', async () => {
    await withParserApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/body',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': '0',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ body: {} });
    });
  });

  it('accepts empty chunked requests without a content type as an empty object', async () => {
    await withParserApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/body',
        headers: {
          'transfer-encoding': 'chunked',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ body: {} });
    });
  });

  it('still rejects non-empty unsupported content types', async () => {
    await withParserApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/body',
        headers: {
          'content-type': 'application/octet-stream',
        },
        payload: 'not json',
      });

      expect(response.statusCode).toBe(415);
      expect(response.json()).toMatchObject({
        message: 'Unsupported Media Type',
        statusCode: 415,
      });
    });
  });

  it('still rejects non-empty bodies without a content type', async () => {
    await withParserApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/body',
        payload: 'not json',
      });

      expect(response.statusCode).toBe(415);
      expect(response.json()).toMatchObject({
        message: 'Unsupported Media Type',
        statusCode: 415,
      });
    });
  });

  it('does not interfere with Fastify JSON parsing', async () => {
    await withParserApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/body',
        headers: {
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ ok: true }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ body: { ok: true } });
    });
  });

  it('feeds injected empty JSON bodies as buffers for Nest-style Fastify parsers', async () => {
    await withNestBufferParserApp(async (app) => {
      const response = await requestApp(app, {
        method: 'POST',
        path: '/body',
        headers: {
          'content-type': 'application/json',
          'content-length': '0',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ body: {} });
    });
  });
});

describe('isSecureProtocol', () => {
  it('returns true only for https', () => {
    expect(isSecureProtocol('https')).toBe(true);
  });

  it('returns false for http', () => {
    expect(isSecureProtocol('http')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSecureProtocol(undefined)).toBe(false);
  });

  it('returns false for unexpected values', () => {
    expect(isSecureProtocol('HTTPS')).toBe(false);
    expect(isSecureProtocol('')).toBe(false);
    expect(isSecureProtocol('ftp')).toBe(false);
  });
});

describe('applyConditionalHsts', () => {
  it('sets the Strict-Transport-Security header for secure requests', () => {
    const reply = { header: vi.fn() };

    applyConditionalHsts({ protocol: 'https' }, reply);

    expect(reply.header).toHaveBeenCalledTimes(1);
    expect(reply.header).toHaveBeenCalledWith('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  it('does not set the header for plain HTTP requests', () => {
    const reply = { header: vi.fn() };

    applyConditionalHsts({ protocol: 'http' }, reply);

    expect(reply.header).not.toHaveBeenCalled();
  });
});

describe('registerConditionalHsts (integration)', () => {
  it('sends HSTS when a trusted proxy forwards a secure request', async () => {
    await withHstsApp({ trustProxy: true }, async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: '/ping',
        headers: { 'x-forwarded-proto': 'https' },
      });

      expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    });
  });

  it('does not send HSTS for a plain HTTP request with no proxy involved', async () => {
    await withHstsApp({ trustProxy: true }, async (app) => {
      const response = await app.inject({ method: 'GET', url: '/ping' });

      expect(response.headers['strict-transport-security']).toBeUndefined();
    });
  });

  it('does not trust a forwarded-proto header when the proxy is not configured as trusted', async () => {
    await withHstsApp({ trustProxy: false }, async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: '/ping',
        headers: { 'x-forwarded-proto': 'https' },
      });

      expect(response.headers['strict-transport-security']).toBeUndefined();
    });
  });
});

async function withHstsApp(options: { trustProxy: boolean }, run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false, trustProxy: options.trustProxy });
  await app.register(fastifyHelmet, buildHelmetOptions());
  registerConditionalHsts(app);
  app.get('/ping', () => ({ ok: true }));

  try {
    await app.ready();
    await run(app);
  } finally {
    await app.close();
  }
}

async function withCspApp(run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false });
  await app.register(fastifyHelmet, buildHelmetOptions());
  app.get('/ping', () => ({ ok: true }));

  try {
    await app.ready();
    await run(app);
  } finally {
    await app.close();
  }
}

async function withParserApp(run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false });
  registerEmptyBodyContentTypeParser(app);
  app.post('/body', (request) => ({ body: request.body ?? null }));

  try {
    await app.ready();
    await run(app);
  } finally {
    await app.close();
  }
}

async function withNestBufferParserApp(run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false });
  app.addHook('preParsing', (request, _reply, payload, done) => {
    if (shouldInjectEmptyJsonBody(request.method, request.headers)) {
      done(null, buildEmptyJsonBodyStream(request.headers));
      return;
    }
    done(null, payload);
  });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body: Buffer, done) => {
    done(null, JSON.parse(body.toString('utf8')));
  });
  app.post('/body', (request) => ({ body: request.body ?? null }));

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    await run(app);
  } finally {
    await app.close();
  }
}

async function requestApp(
  app: FastifyInstance,
  options: { method: string; path: string; headers: Record<string, string> },
): Promise<{ statusCode: number; body: string }> {
  const address = app.server.address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: options.method,
        host: address.address,
        port: address.port,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
