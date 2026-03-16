import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { MetadataFetchModule } from '../metadata-fetch/metadata-fetch.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchController } from './book-metadata-fetch.controller';
import { BookMetadataFetchEligibilityService } from './book-metadata-fetch-eligibility.service';
import { BookMetadataFetchGateway } from './book-metadata-fetch.gateway';
import { BookMetadataFetchOrchestratorService } from './book-metadata-fetch-orchestrator.service';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';

@Module({
  imports: [
    forwardRef(() => BookModule),
    MetadataModule,
    MetadataFetchModule,
    MetadataScoreModule,
    AuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [BookMetadataFetchController],
  providers: [
    BookMetadataFetchSessionService,
    BookMetadataFetchQueueRepository,
    BookMetadataFetchEligibilityService,
    BookMetadataFetchConfigService,
    BookMetadataFetchOrchestratorService,
    BookMetadataFetchGateway,
  ],
  exports: [BookMetadataFetchOrchestratorService],
})
export class BookMetadataFetchModule {}
