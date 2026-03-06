jest.mock('fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('../../../common/sevenzip', () => ({ getSevenZip: jest.fn() }));

import { readFile } from 'fs/promises';

import { getSevenZip } from '../../../common/sevenzip';
import { extractCb7Cover } from './cover-cb7';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockGetSevenZip = getSevenZip as jest.MockedFunction<typeof getSevenZip>;

describe('extractCb7Cover', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);
  });

  it('extracts first natural-sorted image and cleans wasm VFS artifacts', async () => {
    const fsApi = {
      open: jest.fn().mockReturnValue(1),
      write: jest.fn(),
      close: jest.fn(),
      mkdir: jest.fn(),
      readdir: jest.fn().mockReturnValue(['.', '..', '10.jpg', '2.jpg']),
      readFile: jest.fn().mockReturnValue(Uint8Array.from([1, 2, 3])),
      unlink: jest.fn(),
      rmdir: jest.fn(),
    };

    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain: jest.fn() } as any);

    await expect(extractCb7Cover('/book.cb7')).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fsApi.unlink).toHaveBeenCalled();
    expect(fsApi.rmdir).toHaveBeenCalled();
  });

  it('returns null when extracted folder has no image files', async () => {
    const fsApi = {
      open: jest.fn().mockReturnValue(1),
      write: jest.fn(),
      close: jest.fn(),
      mkdir: jest.fn(),
      readdir: jest.fn().mockReturnValue(['.', '..', 'notes.txt']),
      readFile: jest.fn(),
      unlink: jest.fn(),
      rmdir: jest.fn(),
    };

    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain: jest.fn() } as any);

    await expect(extractCb7Cover('/book.cb7')).resolves.toBeNull();
  });

  it('returns null on extraction failures', async () => {
    mockGetSevenZip.mockRejectedValue(new Error('7z unavailable'));
    await expect(extractCb7Cover('/book.cb7')).resolves.toBeNull();
  });
});
