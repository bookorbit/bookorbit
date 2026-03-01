import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { join } from 'path';
import { Readable } from 'stream';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';

const MAX_COVER_BYTES = 20 * 1024 * 1024;

async function bootstrap() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', 'src', 'db', 'migrations') });
  await pool.end();

  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const fastify = adapter.getInstance();

  // Kobo devices send Content-Type: application/json with empty bodies on GET/DELETE.
  // Fastify's default JSON parser rejects empty bodies, so we inject '{}' before parsing.
  fastify.addHook('preParsing', (request, _reply, payload, done) => {
    const ct = request.headers['content-type'] ?? '';
    const isJson = ct.startsWith('application/json');
    const isEmpty = request.headers['content-length'] === '0' || request.headers['content-length'] === undefined;
    if (isJson && isEmpty) {
      const fake = new Readable();
      fake.push('{}');
      fake.push(null);
      done(null, fake);
      return;
    }
    done(null, payload);
  });

  // Echo pino-http's request ID so clients can correlate errors with server logs.
  fastify.addHook('onSend', (_request, reply, _payload, done) => {
    const id = reply.request.id;
    if (id !== undefined && id !== null) {
      void reply.header('X-Request-Id', String(id));
    }
    done();
  });

  app.useWebSocketAdapter(new IoAdapter(app));

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  await app.register(fastifyCompress, { encodings: ['gzip', 'br'] });

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_COVER_BYTES } });

  // Rate limit unauthenticated requests only (brute-force protection on public endpoints).
  // Bypass for: JWT cookie (web app), Authorization header (OPDS Basic Auth),
  // and Kobo device endpoints (token-authenticated via URL).
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (req: { cookies?: { access_token?: string }; headers?: { authorization?: string }; url?: string }) =>
      !!req.cookies?.access_token || !!req.headers?.authorization || /^\/api\/v1\/kobo\//.test(req.url ?? ''),
  });

  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
      credentials: true,
    });
  }

  if (process.env.NODE_ENV === 'production') {
    await app.register(fastifyStatic, {
      root: join(__dirname, '..', 'public'),
      prefix: '/',
      decorateReply: false,
    });
  }

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

void bootstrap();
