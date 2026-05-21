import { Module, forwardRef } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { NotificationModule } from '../notification/notification.module';
import { FileLockService } from './file-lock.service';
import { FileRenameRepository } from './file-rename.repository';
import { FileRenameService } from './file-rename.service';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteService } from './file-write.service';
import { FormatWriterRegistry } from './format-writer.registry';
import { Cb7FormatWriter } from './formats/cbx/cb7-format-writer';
import { CbzFormatWriter } from './formats/cbx/cbz-format-writer';
import { EpubFormatWriter } from './formats/epub/epub-format-writer';
import { PdfFormatWriter } from './formats/pdf/pdf-format-writer';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';

@Module({
  imports: [forwardRef(() => NotificationModule), AppSettingsModule],
  providers: [
    FileWriteService,
    FileWriteRepository,
    FileRenameRepository,
    FileRenameService,
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
  exports: [FileWriteService, FileWriteRepository, FileRenameService],
})
export class FileWriteModule {}
