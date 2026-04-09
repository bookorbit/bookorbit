import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { join } from 'path';
import { Readable } from 'stream';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';

const MAX_COVER_BYTES = 20 * 1024 * 1024;

async function bootstrap() {
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

  app.setGlobalPrefix('api/v1', {
    exclude: ['api/kobo/:deviceToken/(.*)'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.register(fastifyHelmet as never, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'blob:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        frameSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
      },
    },
  });

  await app.register(fastifyCompress as never, { encodings: ['gzip', 'br'] });

  await app.register(fastifyCookie as never);
  await app.register(fastifyMultipart as never, { limits: { fileSize: MAX_COVER_BYTES } });

  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
      credentials: true,
    });
  }

  if (process.env.NODE_ENV === 'production') {
    // NestJS calls setNotFoundHandler during init — intercept it so non-API 404s
    // fall back to index.html instead of returning a JSON 404 (SPA routing support).
    const adapterAny = adapter as any;
    adapterAny.setNotFoundHandler = (nestHandler: (req: unknown, res: unknown) => void) => {
      fastify.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api')) {
          return nestHandler(request, reply);
        }
        return reply.sendFile('index.html');
      });
    };

    await app.register(fastifyStatic as never, {
      root: join(__dirname, '..', 'public'),
      prefix: '/',
    });
  }

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

void bootstrap();
