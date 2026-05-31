import { Module } from '@nestjs/common';

import { AnnasArchiveController } from './annas-archive.controller';
import { AnnasArchiveService } from './annas-archive.service';

@Module({
  controllers: [AnnasArchiveController],
  providers: [AnnasArchiveService],
})
export class AnnasArchiveModule {}
