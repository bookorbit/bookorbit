import { MODULE_METADATA } from '@nestjs/common/constants';

import { FileLockService } from './file-lock.service';
import { FileWriteModule } from './file-write.module';
import { FileWriteRepository } from './file-write.repository';
import { FileWriteService } from './file-write.service';
import { FormatWriterRegistry } from './format-writer.registry';
import { Cb7FormatWriter } from './formats/cbx/cb7-format-writer';
import { CbzFormatWriter } from './formats/cbx/cbz-format-writer';
import { EpubFormatWriter } from './formats/epub/epub-format-writer';
import { PdfFormatWriter } from './formats/pdf/pdf-format-writer';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';

describe('FileWriteModule', () => {
  it('registers expected providers, exports, and writer factory token', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, FileWriteModule);
    const exportsMeta = Reflect.getMetadata(MODULE_METADATA.EXPORTS, FileWriteModule);

    expect(providers).toEqual(
      expect.arrayContaining([
        FileWriteService,
        FileWriteRepository,
        FileLockService,
        EpubFormatWriter,
        PdfFormatWriter,
        CbzFormatWriter,
        Cb7FormatWriter,
        FormatWriterRegistry,
      ]),
    );

    expect(exportsMeta).toEqual(expect.arrayContaining([FileWriteService, FileWriteRepository]));

    const writerProvider = providers.find((p: { provide?: unknown }) => p?.provide === FORMAT_WRITERS) as {
      useFactory: (...args: unknown[]) => unknown;
      inject: unknown[];
    };

    expect(writerProvider).toBeDefined();
    expect(writerProvider.inject).toEqual([EpubFormatWriter, PdfFormatWriter, CbzFormatWriter, Cb7FormatWriter]);

    const epub = { format: 'epub' };
    const pdf = { format: 'pdf' };
    const cbz = { format: 'cbz' };
    const cb7 = { format: 'cb7' };
    expect(writerProvider.useFactory(epub, pdf, cbz, cb7)).toEqual([epub, pdf, cbz, cb7]);
  });
});
