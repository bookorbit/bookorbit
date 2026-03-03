import { Module } from '@nestjs/common';

import { FileLockService } from './file-lock.service';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteService } from './file-write.service';
import { FileWriteSettingsService } from './file-write-settings.service';
import { FormatWriterRegistry } from './format-writer.registry';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';
import { EpubFormatWriter } from './formats/epub/epub-format-writer';
import { PdfFormatWriter } from './formats/pdf/pdf-format-writer';

@Module({
  providers: [
    FileWriteService,
    FileWriteRepository,
    FileWriteSettingsService,
    FileLockService,
    EpubFormatWriter,
    PdfFormatWriter,
    {
      provide: FORMAT_WRITERS,
      useFactory: (epub: EpubFormatWriter, pdf: PdfFormatWriter) => [epub, pdf],
      inject: [EpubFormatWriter, PdfFormatWriter],
    },
    FormatWriterRegistry,
  ],
  exports: [FileWriteService, FileWriteRepository, FileWriteSettingsService],
})
export class FileWriteModule {}
