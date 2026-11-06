import { unlink } from 'fs/promises';
import { Logger } from '@nestjs/common';
import { ERR_AMBIGUOUS_ARCHIVE } from '@zip.js/zip.js';
import * as unzipper from 'unzipper';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { writeZipArchive, type ZipRewriteEntry } from '../shared/zip-rewrite';
import { rewriteEpubZip } from './epub-zip-rewrite';
import { listEntryPaths, patch, readEntry } from './epub-zip-patcher';

vi.mock('fs/promises', () => ({ unlink: vi.fn() }));
vi.mock('unzipper', () => ({ Open: { file: vi.fn() } }));
vi.mock('./epub-zip-rewrite', () => ({ rewriteEpubZip: vi.fn() }));
vi.mock('../shared/zip-rewrite', () => ({ writeZipArchive: vi.fn() }));
vi.mock('../shared/atomic-file-replace', () => ({ replaceFileAtomically: vi.fn() }));

const mockOpenFile = vi.mocked(unzipper.Open.file);
const mockRewrite = vi.mocked(rewriteEpubZip);
const mockWriteArchive = vi.mocked(writeZipArchive);
const mockReplace = vi.mocked(replaceFileAtomically);
const mockUnlink = vi.mocked(unlink);

function ambiguousArchive(reason?: string): Error {
  return Object.assign(new Error(ERR_AMBIGUOUS_ARCHIVE), reason ? { reason } : {});
}

describe('epub-zip-patcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRewrite.mockResolvedValue(undefined);
    mockReplace.mockResolvedValue(undefined);
    mockWriteArchive.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  it('readEntry returns UTF-8 text for an existing entry', async () => {
    mockOpenFile.mockResolvedValue({
      files: [{ path: 'OPS/content.opf', buffer: vi.fn().mockResolvedValue(Buffer.from('<package/>')) }],
    } as never);
    await expect(readEntry('/path/to/book.epub', 'OPS/content.opf')).resolves.toBe('<package/>');
  });

  it('readEntry rejects a missing entry', async () => {
    mockOpenFile.mockResolvedValue({ files: [] } as never);
    await expect(readEntry('/path/to/book.epub', 'OPS/content.opf')).rejects.toThrow('Entry not found in EPUB: OPS/content.opf');
  });

  it('lists every occupied archive entry path', async () => {
    mockOpenFile.mockResolvedValue({ files: [{ path: 'mimetype' }, { path: 'OPS/content.opf' }, { path: 'OPS/images/cover.webp' }] } as never);
    await expect(listEntryPaths('/path/to/book.epub')).resolves.toEqual(['mimetype', 'OPS/content.opf', 'OPS/images/cover.webp']);
  });

  it('replaces the original only after the rewrite completes', async () => {
    const patches = new Map([['OPS/content.opf', Buffer.from('new-opf')]]);
    mockRewrite.mockImplementation(() => {
      expect(mockReplace).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await patch('/path/to/book.epub', patches);
    const tempPath = mockRewrite.mock.calls[0]![1];
    expect(tempPath).toMatch(/^\/path\/to\/\.epub-write-[0-9a-f-]{36}$/);
    expect(mockRewrite).toHaveBeenCalledWith('/path/to/book.epub', tempPath, patches);
    expect(mockReplace).toHaveBeenCalledWith(tempPath, '/path/to/book.epub');
  });

  it('uses distinct short temporary names even for a long book filename', async () => {
    const longName = `/path/to/${'L'.repeat(250)}.epub`;
    await patch(longName, new Map());
    await patch(longName, new Map());
    const paths = mockRewrite.mock.calls.map((call) => call[1]);
    expect(paths[0]).not.toBe(paths[1]);
    for (const path of paths) expect(path).toMatch(/^\/path\/to\/\.epub-write-[0-9a-f-]{36}$/);
  });

  it('never replaces the original when the rewrite fails', async () => {
    mockRewrite.mockRejectedValue(new Error('read failed'));
    await expect(patch('/path/to/book.epub', new Map())).rejects.toThrow('read failed');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockOpenFile).not.toHaveBeenCalled();
    expect(mockWriteArchive).not.toHaveBeenCalled();
  });

  describe('when the direct record copy finds an ambiguous archive', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const archiveFiles = ['mimetype', 'OPS/content.opf', 'OPS/chapter.xhtml'].map((path) => ({
        path,
        stream: vi.fn().mockReturnValue(`stream:${path}`),
      }));
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      mockRewrite.mockRejectedValue(ambiguousArchive('mismatched local file header (compression method)'));
      mockOpenFile.mockResolvedValue({ files: archiveFiles } as never);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    async function collectEntries(): Promise<ZipRewriteEntry[]> {
      let entries: ZipRewriteEntry[] = [];
      mockWriteArchive.mockImplementation((_tmpPath, source) => {
        entries = [...source];
        return Promise.resolve();
      });
      await patch(
        '/path/to/book.epub',
        new Map([
          ['OPS/content.opf', Buffer.from('new-opf')],
          ['OPS/images/new-cover.jpg', Buffer.from('new-cover')],
        ]),
      );
      return entries;
    }

    it('rewrites every entry with the patches applied and the mimetype first and stored', async () => {
      const entries = await collectEntries();
      expect(entries.map((entry) => entry.name)).toEqual(['mimetype', 'OPS/content.opf', 'OPS/chapter.xhtml', 'OPS/images/new-cover.jpg']);
      expect(entries[0]).toEqual({ name: 'mimetype', source: Buffer.from('application/epub+zip'), store: true });
      expect(entries[1]!.source).toEqual(Buffer.from('new-opf'));
      expect(typeof entries[2]!.source).toBe('function');
      expect((entries[2]!.source as () => unknown)()).toBe('stream:OPS/chapter.xhtml');
      expect(entries[3]!.source).toEqual(Buffer.from('new-cover'));
    });

    it('replaces the original with the rebuilt archive and logs the reason zip.js gave', async () => {
      await collectEntries();
      const tempPath = mockRewrite.mock.calls[0]![1];
      expect(mockWriteArchive.mock.calls[0]![0]).toBe(tempPath);
      expect(mockReplace).toHaveBeenCalledWith(tempPath, '/path/to/book.epub');
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toMatch(
        /^\[epub_zip\.rewrite\] \[fail\] durationMs=\d+ errorClass=Error reason="mismatched local file header \(compression method\)" error="Ambiguous archive" - /,
      );
    });

    it('never emits the mimetype twice when it is patched', async () => {
      let entries: ZipRewriteEntry[] = [];
      mockWriteArchive.mockImplementation((_tmpPath, source) => {
        entries = [...source];
        return Promise.resolve();
      });
      await patch('/path/to/book.epub', new Map([['mimetype', Buffer.from('other')]]));
      expect(entries.filter((entry) => entry.name === 'mimetype')).toHaveLength(1);
      expect(entries[0]!.source).toEqual(Buffer.from('application/epub+zip'));
    });

    it('reports an unknown reason when zip.js gives none', async () => {
      mockRewrite.mockRejectedValue(ambiguousArchive());
      await patch('/path/to/book.epub', new Map());
      expect(warn.mock.calls[0]![0]).toContain('reason="unknown"');
    });

    it('removes the partial archive and keeps the original when the rebuild fails too', async () => {
      mockWriteArchive.mockRejectedValue(new Error('inflate failed'));
      await expect(patch('/path/to/book.epub', new Map())).rejects.toThrow('inflate failed');
      expect(mockUnlink).toHaveBeenCalledWith(mockRewrite.mock.calls[0]![1]);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('surfaces the failure to open the archive for the rebuild without replacing the original', async () => {
      mockOpenFile.mockRejectedValue(new Error('FILE_ENDED'));
      await expect(patch('/path/to/book.epub', new Map())).rejects.toThrow('FILE_ENDED');
      expect(mockWriteArchive).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  it('propagates atomic replacement failures', async () => {
    mockReplace.mockRejectedValue(new Error('rename failed'));
    await expect(patch('/path/to/book.epub', new Map())).rejects.toThrow('rename failed');
  });
});
