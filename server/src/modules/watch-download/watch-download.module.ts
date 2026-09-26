import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { EpubModule } from '../reader/epub/epub.module';
import { WatchDownloadController } from './watch-download.controller';
import { WatchDownloadService } from './watch-download.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    AuthModule,
    BookModule,
    CommonModule,
    EpubModule,
  ],
  controllers: [WatchDownloadController],
  providers: [WatchDownloadService],
})
export class WatchDownloadModule {}
