import { Module } from '@nestjs/common';

import { FileLockService } from './file-lock.service';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteService } from './file-write.service';
import { FormatWriterRegistry } from './format-writer.registry';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';
import { EpubFormatWriter } from './formats/epub/epub-format-writer';
import { PdfFormatWriter } from './formats/pdf/pdf-format-writer';
import { CbzFormatWriter } from './formats/cbx/cbz-format-writer';
import { Cb7FormatWriter } from './formats/cbx/cb7-format-writer';

@Module({
  providers: [
    FileWriteService,
    FileWriteRepository,
    FileLockService,
    EpubFormatWriter,
    PdfFormatWriter,
    CbzFormatWriter,
    Cb7FormatWriter,
    {
      provide: FORMAT_WRITERS,
      useFactory: (epub: EpubFormatWriter, pdf: PdfFormatWriter, cbz: CbzFormatWriter, cb7: Cb7FormatWriter) => [epub, pdf, cbz, cb7],
      inject: [EpubFormatWriter, PdfFormatWriter, CbzFormatWriter, Cb7FormatWriter],
    },
    FormatWriterRegistry,
  ],
  exports: [FileWriteService, FileWriteRepository],
})
export class FileWriteModule {}
