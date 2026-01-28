import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuthModule } from '../auth/auth.module';
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
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.get('auth.jwtExpiresIn') as any },
      }),
    }),
  ],
  controllers: [ScannerController],
  providers: [ScannerService, ScannerRepository, ScanGateway, ScanJobStore, FileEventProcessorService, FileWatcherService],
  exports: [ScannerService],
})
export class ScannerModule {}
