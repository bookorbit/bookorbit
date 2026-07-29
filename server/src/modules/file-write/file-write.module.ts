import { Module, forwardRef } from '@nestjs/common';

import { SelfWriteRegistryModule } from '../../common/self-write-registry.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { NotificationModule } from '../notification/notification.module';
import { BulkRenameRepository } from './bulk-rename.repository';
import { FileLockService } from './file-lock.service';
import { FileRenameRepository } from './file-rename.repository';
import { FileRenameService } from './file-rename.service';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteService } from './file-write.service';
import { FormatWriterRegistry } from './format-writer.registry';
import { FlacAudioFormatWriter, M4aAudioFormatWriter, M4bAudioFormatWriter, Mp3AudioFormatWriter } from './formats/audio/audio-format-writer';
import { AudioMetadataEmbedder } from './formats/audio/audio-metadata-embedder';
import { Cb7FormatWriter } from './formats/cbx/cb7-format-writer';
import { CbzFormatWriter } from './formats/cbx/cbz-format-writer';
import { EpubFormatWriter } from './formats/epub/epub-format-writer';
import { Fb2FormatWriter } from './formats/fb2/fb2-format-writer';
import { Azw3FormatWriter, AzwFormatWriter, MobiEbookFormatWriter } from './formats/mobi/mobi-format-writer';
import { PdfFormatWriter } from './formats/pdf/pdf-format-writer';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';

@Module({
  imports: [forwardRef(() => NotificationModule), AppSettingsModule, SelfWriteRegistryModule],
  providers: [
    FileWriteService,
    FileWriteRepository,
    FileRenameRepository,
    FileRenameService,
    FileLockService,
    BulkRenameRepository,
    AudioMetadataEmbedder,
    EpubFormatWriter,
    Fb2FormatWriter,
    PdfFormatWriter,
    CbzFormatWriter,
    Cb7FormatWriter,
    MobiEbookFormatWriter,
    Azw3FormatWriter,
    AzwFormatWriter,
    M4bAudioFormatWriter,
    M4aAudioFormatWriter,
    Mp3AudioFormatWriter,
    FlacAudioFormatWriter,
    {
      provide: FORMAT_WRITERS,
      useFactory: (
        epub: EpubFormatWriter,
        fb2: Fb2FormatWriter,
        pdf: PdfFormatWriter,
        cbz: CbzFormatWriter,
        cb7: Cb7FormatWriter,
        mobi: MobiEbookFormatWriter,
        azw3: Azw3FormatWriter,
        azw: AzwFormatWriter,
        m4b: M4bAudioFormatWriter,
        m4a: M4aAudioFormatWriter,
        mp3: Mp3AudioFormatWriter,
        flac: FlacAudioFormatWriter,
      ) => [epub, fb2, pdf, cbz, cb7, mobi, azw3, azw, m4b, m4a, mp3, flac],
      inject: [
        EpubFormatWriter,
        Fb2FormatWriter,
        PdfFormatWriter,
        CbzFormatWriter,
        Cb7FormatWriter,
        MobiEbookFormatWriter,
        Azw3FormatWriter,
        AzwFormatWriter,
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
