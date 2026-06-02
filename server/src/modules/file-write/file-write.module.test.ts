import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { FileLockService } from './file-lock.service';
import { FileRenameRepository } from './file-rename.repository';
import { FileRenameService } from './file-rename.service';
import { FileWriteModule } from './file-write.module';
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

describe('FileWriteModule', () => {
  it('registers expected providers, exports, and writer factory token', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FileWriteModule);
    const exportsMeta = Reflect.getMetadata(MODULE_METADATA.EXPORTS, FileWriteModule);
    const importsMeta = Reflect.getMetadata(MODULE_METADATA.IMPORTS, FileWriteModule);

    expect(importsMeta).toEqual(expect.arrayContaining([AppSettingsModule]));
    expect(providers).toEqual(
      expect.arrayContaining([
        FileWriteService,
        FileWriteRepository,
        FileRenameRepository,
        FileRenameService,
        FileLockService,
        AudioCoverEmbedder,
        EpubFormatWriter,
        PdfFormatWriter,
        CbzFormatWriter,
        Cb7FormatWriter,
        M4bAudioFormatWriter,
        M4aAudioFormatWriter,
        Mp3AudioFormatWriter,
        FlacAudioFormatWriter,
        FormatWriterRegistry,
      ]),
    );

    expect(exportsMeta).toEqual(expect.arrayContaining([FileWriteService, FileWriteRepository, FileRenameService]));

    const writerProvider = providers.find((p: { provide?: unknown }) => p?.provide === FORMAT_WRITERS) as {
      useFactory: (...args: unknown[]) => unknown;
      inject: unknown[];
    };

    expect(writerProvider).toBeDefined();
    expect(writerProvider.inject).toEqual([
      EpubFormatWriter,
      PdfFormatWriter,
      CbzFormatWriter,
      Cb7FormatWriter,
      M4bAudioFormatWriter,
      M4aAudioFormatWriter,
      Mp3AudioFormatWriter,
      FlacAudioFormatWriter,
    ]);

    const epub = { format: 'epub' };
    const pdf = { format: 'pdf' };
    const cbz = { format: 'cbz' };
    const cb7 = { format: 'cb7' };
    const m4b = { format: 'm4b' };
    const m4a = { format: 'm4a' };
    const mp3 = { format: 'mp3' };
    const flac = { format: 'flac' };
    expect(writerProvider.useFactory(epub, pdf, cbz, cb7, m4b, m4a, mp3, flac)).toEqual([epub, pdf, cbz, cb7, m4b, m4a, mp3, flac]);
  });
});
