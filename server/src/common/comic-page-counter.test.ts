vi.mock('fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('node-unrar-js', () => ({ createExtractorFromData: vi.fn() }));
vi.mock('./sevenzip', () => ({ getSevenZip: vi.fn() }));
vi.mock('./comic-format-detect', () => ({
  detectComicContainerFormat: vi.fn().mockImplementation((_path: string, fmt: string) => Promise.resolve(fmt)),
}));
vi.mock('./cbz-zip-reader', () => ({ readCbzZipIndex: vi.fn() }));

import { readFile } from 'fs/promises';
import { createExtractorFromData } from 'node-unrar-js';

import { readCbzZipIndex } from './cbz-zip-reader';
import { getSevenZip } from './sevenzip';
import { countComicPages } from './comic-page-counter';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockReadCbzZipIndex = readCbzZipIndex as MockedFunction<typeof readCbzZipIndex>;
const mockCreateExtractorFromData = createExtractorFromData as MockedFunction<typeof createExtractorFromData>;
const mockGetSevenZip = getSevenZip as MockedFunction<typeof getSevenZip>;

describe('countComicPages', () => {
  it('counts only image entries in a cbz, skipping directories, hidden files, and non-image entries', async () => {
    mockReadCbzZipIndex.mockResolvedValue({
      comment: null,
      entries: [
        { name: 'page1.jpg', compression: 8, compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, dataStart: 0 },
        { name: 'page2.png', compression: 0, compressedSize: 100, uncompressedSize: 100, localHeaderOffset: 0, dataStart: 0 },
        { name: 'folder/', compression: 0, compressedSize: 0, uncompressedSize: 0, localHeaderOffset: 0, dataStart: 0 },
        { name: '.hidden/page.jpg', compression: 8, compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, dataStart: 0 },
        { name: 'ComicInfo.xml', compression: 8, compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, dataStart: 0 },
      ],
    });

    await expect(countComicPages(1, '/books/a.cbz', 'cbz')).resolves.toBe(2);
  });

  it('returns 0 for a cbz with no readable index', async () => {
    mockReadCbzZipIndex.mockResolvedValue(null);
    await expect(countComicPages(1, '/books/a.cbz', 'cbz')).resolves.toBe(0);
  });

  it('counts image files in a cbr file list without extracting', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('rar-bytes'));
    mockCreateExtractorFromData.mockResolvedValue({
      getFileList: () => ({
        fileHeaders: [
          { name: 'page1.jpg', flags: { directory: false } },
          { name: 'page2.jpg', flags: { directory: false } },
          { name: 'sub', flags: { directory: true } },
          { name: 'notes.txt', flags: { directory: false } },
        ],
      }),
      extract: vi.fn(),
    } as never);

    await expect(countComicPages(2, '/books/b.cbr', 'cbr')).resolves.toBe(2);
  });

  it('counts image files extracted from a cb7 archive, recursing into subdirectories and skipping hidden ones', async () => {
    // In-memory tree simulating the extracted archive's directory structure, so
    // the walk can be exercised the same way it would against the real WASM FS.
    const tree: Record<string, string[] | 'file'> = {
      '/countOut3': ['page1.jpg', 'vol1', '.hidden', 'notes.txt'],
      '/countOut3/page1.jpg': 'file',
      '/countOut3/vol1': ['page2.jpg', 'page3.png'],
      '/countOut3/vol1/page2.jpg': 'file',
      '/countOut3/vol1/page3.png': 'file',
      '/countOut3/.hidden': ['page99.jpg'],
      '/countOut3/.hidden/page99.jpg': 'file',
      '/countOut3/notes.txt': 'file',
    };
    const write = vi.fn();
    const open = vi.fn().mockReturnValue(1);
    const close = vi.fn();
    const unlink = vi.fn();
    const rmdir = vi.fn();
    const mkdir = vi.fn();
    const readdir = vi.fn().mockImplementation((path: string) => {
      const entry = tree[path];
      return Array.isArray(entry) ? entry : [];
    });
    const stat = vi.fn().mockImplementation((path: string) => ({ mode: tree[path] === 'file' ? 0o100000 : 0o040000 }));
    const isDir = vi.fn().mockImplementation((mode: number) => mode === 0o040000);
    mockReadFile.mockResolvedValue(Buffer.from('7z-bytes'));
    mockGetSevenZip.mockResolvedValue({
      FS: { open, write, close, mkdir, readdir, readFile: vi.fn(), unlink, rmdir, stat, isDir },
      callMain: vi.fn(),
    });

    // page1.jpg + vol1/page2.jpg + vol1/page3.png = 3; notes.txt is not an image
    // and .hidden/page99.jpg is skipped because .hidden is a hidden directory.
    await expect(countComicPages(3, '/books/c.cb7', 'cb7')).resolves.toBe(3);
    expect(unlink).toHaveBeenCalledWith('/countOut3/page1.jpg');
    expect(unlink).toHaveBeenCalledWith('/countOut3/vol1/page2.jpg');
    expect(unlink).toHaveBeenCalledWith('/countOut3/.hidden/page99.jpg');
    expect(rmdir).toHaveBeenCalledWith('/countOut3/vol1');
    expect(rmdir).toHaveBeenCalledWith('/countOut3/.hidden');
  });
});
