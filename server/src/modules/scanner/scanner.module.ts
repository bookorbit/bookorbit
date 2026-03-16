import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AuthModule } from '../auth/auth.module';
import { BookMetadataFetchModule } from '../book-metadata-fetch/book-metadata-fetch.module';
import { MetadataModule } from '../metadata/metadata.module';
import { FileEventProcessorService } from './file-event-processor.service';
import { FileWatcherService } from './file-watcher.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { ScannerController } from './scanner.controller';
import { ScannerRepository } from './scanner.repository';
import { ScannerService } from './scanner.service';

@Module({
  imports: [
    MetadataModule,
    AuthModule,
    forwardRef(() => BookMetadataFetchModule),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [ScannerController],
  providers: [ScannerService, ScannerRepository, ScanGateway, ScanJobStore, FileEventProcessorService, FileWatcherService],
  exports: [ScannerService, FileWatcherService],
})
export class ScannerModule {}
