jest.mock('fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('node-unrar-js', () => ({ createExtractorFromData: jest.fn() }));

import { readFile } from 'fs/promises';
import { createExtractorFromData } from 'node-unrar-js';

import { extractCbrCover } from './cover-cbr';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockCreateExtractor = createExtractorFromData as jest.MockedFunction<typeof createExtractorFromData>;

describe('extractCbrCover', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from('rar-bytes') as unknown as Awaited<ReturnType<typeof readFile>>);
  });

  it('picks naturally-sorted first visible image and extracts only that file', async () => {
    mockCreateExtractor
      .mockResolvedValueOnce({
        getFileList: () => ({
          fileHeaders: [
            { name: '10.jpg', flags: { directory: false } },
            { name: '2.jpg', flags: { directory: false } },
            { name: '.hidden.jpg', flags: { directory: false } },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({
        extract: () => ({ files: [{ fileHeader: { flags: { directory: false } }, extraction: Uint8Array.from([7, 7, 7]) }] }),
      } as any);

    await expect(extractCbrCover('/book.cbr')).resolves.toEqual(Buffer.from([7, 7, 7]));
  });

  it('returns null when archive has no visible image files', async () => {
    mockCreateExtractor.mockResolvedValue({
      getFileList: () => ({ fileHeaders: [{ name: 'notes.txt', flags: { directory: false } }] }),
    } as any);

    await expect(extractCbrCover('/book.cbr')).resolves.toBeNull();
  });

  it('returns null when extraction errors', async () => {
    mockCreateExtractor.mockRejectedValue(new Error('bad rar'));
    await expect(extractCbrCover('/book.cbr')).resolves.toBeNull();
  });
});
