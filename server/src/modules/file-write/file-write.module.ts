import { Module, forwardRef } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { NotificationModule } from '../notification/notification.module';
import { BulkRenameRepository } from './bulk-rename.repository';
import { FileLockService } from './file-lock.service';
import { FileRenameRepository } from './file-rename.repository';
import { FileRenameService } from './file-rename.service';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteService } from './file-write.service';
import { FormatWriterRegistry } from './format-writer.registry';
import { AudioCoverEmbedder } from './formats/audio/audio-cover-embedder';
import { FlacAudioFormatWriter, M4aAudioFormatWriter, M4bAudioFormatWriter, Mp3AudioFormatWriter } from './formats/audio/audio-format-writer';
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
    BulkRenameRepository,
    AudioCoverEmbedder,
    EpubFormatWriter,
    PdfFormatWriter,
    CbzFormatWriter,
    Cb7FormatWriter,
    M4bAudioFormatWriter,
    M4aAudioFormatWriter,
    Mp3AudioFormatWriter,
    FlacAudioFormatWriter,
    {
      provide: FORMAT_WRITERS,
      useFactory: (
        epub: EpubFormatWriter,
        pdf: PdfFormatWriter,
        cbz: CbzFormatWriter,
        cb7: Cb7FormatWriter,
        m4b: M4bAudioFormatWriter,
        m4a: M4aAudioFormatWriter,
        mp3: Mp3AudioFormatWriter,
        flac: FlacAudioFormatWriter,
      ) => [epub, pdf, cbz, cb7, m4b, m4a, mp3, flac],
      inject: [
        EpubFormatWriter,
        PdfFormatWriter,
        CbzFormatWriter,
        Cb7FormatWriter,
        M4bAudioFormatWriter,
        M4aAudioFormatWriter,
        Mp3AudioFormatWriter,
        FlacAudioFormatWriter,
      ],
    },
    FormatWriterRegistry,
  ],
  exports: [FileWriteService, FileWriteRepository, FileRenameService, FileRenameRepository, BulkRenameRepository],
})
export class FileWriteModule {}
