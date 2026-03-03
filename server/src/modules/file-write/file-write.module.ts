import { Module } from '@nestjs/common';

import { FileLockService } from './file-lock.service';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteService } from './file-write.service';
import { FileWriteSettingsService } from './file-write-settings.service';
import { FormatWriterRegistry } from './format-writer.registry';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';
import { EpubFormatWriter } from './formats/epub/epub-format-writer';

@Module({
  providers: [
    FileWriteService,
    FileWriteRepository,
    FileWriteSettingsService,
    FileLockService,
    EpubFormatWriter,
    {
      provide: FORMAT_WRITERS,
      useFactory: (epub: EpubFormatWriter) => [epub],
      inject: [EpubFormatWriter],
    },
    FormatWriterRegistry,
  ],
  exports: [FileWriteService, FileWriteRepository, FileWriteSettingsService],
})
export class FileWriteModule {}
