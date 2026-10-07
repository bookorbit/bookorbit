import { Test } from '@nestjs/testing';
import { mkdtemp, readFile, rename, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ReadStream } from 'fs';

import { computeFileHash } from '../../../common/utils/file-hash.utils';
import { AudiolessEpubService } from '../../book/audioless-epub.service';
import { KoboDownloadRepository } from '../kobo-download.repository';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KepubConversionService } from './kepub-conversion.service';
import { KoboDownloadHashRegistrationService } from './kobo-download-hash-registration.service';
import { KoboDownloadService } from './kobo-download.service';
import { KoboSettingsService } from './kobo-settings.service';

describe('Kobo delivered file descriptor', () => {
  it('streams the exact bytes it hashed even if the path is replaced during registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kobo-delivery-descriptor-'));
    try {
      const path = join(root, 'download.kepub.epub');
      const original = Buffer.from('The originally delivered artifact');
      const replacement = Buffer.from('A different concurrently published artifact with a different length');
      await writeFile(path, original);
      const originalHash = await computeFileHash(path);
      const register = vi.fn().mockImplementation(async () => {
        await rename(path, join(root, 'previous.kepub.epub'));
        await writeFile(path, replacement);
      });
      const module = await Test.createTestingModule({
        providers: [
          KoboDownloadService,
          { provide: KoboDownloadHashRegistrationService, useValue: { record: register } },
          {
            provide: KoboDownloadRepository,
            useValue: {
              findBook: vi.fn().mockResolvedValue({ id: 11, primaryFileId: 22 }),
              findPrimaryFile: vi
                .fn()
                .mockResolvedValue({ id: 22, format: 'epub', absolutePath: path, sizeBytes: original.length, fileHash: 'b'.repeat(32) }),
              registerDeliveredHash: register,
            },
          },
          { provide: KepubConversionService, useValue: { getKepubPath: vi.fn().mockResolvedValue(path) } },
          {
            provide: KoboSettingsService,
            useValue: { getSettings: vi.fn().mockResolvedValue({ convertToKepub: true, kepubConversionLimitMb: 10 }) },
          },
          { provide: KoboBookAccessService, useValue: { assertBookAccessible: vi.fn().mockResolvedValue(undefined) } },
          { provide: AudiolessEpubService, useValue: {} },
        ],
      }).compile();
      let consume!: Promise<Buffer>;
      const reply = {
        header: vi.fn().mockReturnThis(),
        type: vi.fn().mockReturnThis(),
        send: vi.fn((stream: ReadStream) => {
          consume = (async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
            return Buffer.concat(chunks);
          })();
        }),
      };
      await module.get(KoboDownloadService).streamBook(7, 11, reply as never);
      await expect(consume).resolves.toEqual(original);
      expect(register).toHaveBeenCalledExactlyOnceWith(22, originalHash);
      expect(reply.header).toHaveBeenCalledWith('Content-Length', original.length);
      expect(await readFile(path)).toEqual(replacement);
      expect(await computeFileHash(path)).not.toBe(originalHash);
      await module.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
