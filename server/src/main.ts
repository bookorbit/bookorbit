import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { join } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function bootstrap() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', 'src', 'db', 'migrations') });
  await pool.end();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.register(require('@fastify/cookie'));

  // Global IP-based rate limit; tighten per-route as needed
  await app.register(require('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
  });

  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
      credentials: true,
    });
  }

  if (process.env.NODE_ENV === 'production') {
    await app.register(require('@fastify/static'), {
      root: join(__dirname, '..', 'public'),
      prefix: '/',
      decorateReply: false,
    });
  }

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap();
