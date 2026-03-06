import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import { dbConfig } from '../config/config';
import { validateEnv } from '../config/env.validation';
import { DbModule } from '../db/db.module';
import { SeedModule } from '../modules/seed/seed.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [dbConfig],
    }),
    DbModule,
    SeedModule,
  ],
})
class SeedCliModule {}

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedCliModule, {
    logger: ['error', 'warn', 'log'],
  });
  await app.close();
}

void run();
