import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from 'nestjs-pino';
import type { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { join } from 'path';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import { appConfig } from './config/config';
import { setupSwaggerDocs } from './swagger';
import {
  parseBooleanEnv,
  parseTrustProxy,
  buildCspDirectives,
  buildEmptyJsonBodyStream,
  registerEmptyBodyContentTypeParser,
  shouldInjectEmptyJsonBody,
} from './common/utils/bootstrap.utils';

const MAX_COVER_BYTES = 20 * 1024 * 1024;

async function bootstrap() {
  const allowCloudflareInsights = parseBooleanEnv(process.env.CSP_ALLOW_CLOUDFLARE_INSIGHTS, false);

  const adapter = new FastifyAdapter({ logger: false, trustProxy: parseTrustProxy(process.env.TRUST_PROXY), maxParamLength: 1000 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const fastify = adapter.getInstance();

  // Fastify's default JSON parser rejects empty bodies, so we inject '{}' before parsing.
  fastify.addHook('preParsing', (request, _reply, payload, done) => {
    if (shouldInjectEmptyJsonBody(request.method, request.headers)) {
      done(null, buildEmptyJsonBodyStream(request.headers));
      return;
    }
    done(null, payload);
  });
  // Reverse proxies can forward empty mutating requests with chunked transfer or an unsupported content type.
  registerEmptyBodyContentTypeParser(fastify);

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
    exclude: ['api/kobo/:deviceToken/(.*)', 'api/v3/(.*)', 'api/UserStorage/(.*)'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const appConfiguration = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  if (appConfiguration.swaggerEnabled) {
    await setupSwaggerDocs(app, appConfiguration);
  }

  await app.register(fastifyHelmet as never, {
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: {
      directives: buildCspDirectives({ allowCloudflareInsights }),
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

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`BookOrbit startup failed:\n${message}\n`);
  process.exit(1);
});
