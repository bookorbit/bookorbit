vi.mock('fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('../../../common/sevenzip', () => ({ getSevenZip: vi.fn() }));

import { readFile } from 'fs/promises';

import { getSevenZip } from '../../../common/sevenzip';
import { extractCb7Cover } from './cover-cb7';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockGetSevenZip = getSevenZip as MockedFunction<typeof getSevenZip>;

describe('extractCb7Cover', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Awaited<ReturnType<typeof readFile>>);
  });

  it('extracts first natural-sorted image and cleans wasm VFS artifacts', async () => {
    const fsApi = {
      open: vi.fn().mockReturnValue(1),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn().mockReturnValue(['.', '..', '10.jpg', '2.jpg']),
      readFile: vi.fn().mockReturnValue(Uint8Array.from([1, 2, 3])),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };

    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain: vi.fn() } as any);

    await expect(extractCb7Cover('/book.cb7')).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fsApi.unlink).toHaveBeenCalled();
    expect(fsApi.rmdir).toHaveBeenCalled();
  });

  it('returns null when extracted folder has no image files', async () => {
    const fsApi = {
      open: vi.fn().mockReturnValue(1),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn().mockReturnValue(['.', '..', 'notes.txt']),
      readFile: vi.fn(),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };

    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain: vi.fn() } as any);

    await expect(extractCb7Cover('/book.cb7')).resolves.toBeNull();
  });

  it('returns null on extraction failures', async () => {
    mockGetSevenZip.mockRejectedValue(new Error('7z unavailable'));
    await expect(extractCb7Cover('/book.cb7')).resolves.toBeNull();
  });

  it('cleans up VFS artifacts even when extraction command throws', async () => {
    const fsApi = {
      open: vi.fn().mockReturnValue(1),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn().mockReturnValue(['.', '..']),
      readFile: vi.fn(),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };
    const callMain = vi.fn().mockImplementation(() => {
      throw new Error('extract failed');
    });

    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain } as any);

    await expect(extractCb7Cover('/book.cb7')).resolves.toBeNull();
    expect(fsApi.rmdir).toHaveBeenCalled();
    expect(fsApi.unlink).toHaveBeenCalled();
  });
});
