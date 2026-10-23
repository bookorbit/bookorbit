import * as unzipper from 'unzipper';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { rewriteEpubZip } from './epub-zip-rewrite';
import { listEntryPaths, patch, readEntry } from './epub-zip-patcher';

vi.mock('unzipper', () => ({ Open: { file: vi.fn() } }));
vi.mock('./epub-zip-rewrite', () => ({ rewriteEpubZip: vi.fn() }));
vi.mock('../shared/atomic-file-replace', () => ({ replaceFileAtomically: vi.fn() }));

const mockOpenFile = vi.mocked(unzipper.Open.file);
const mockRewrite = vi.mocked(rewriteEpubZip);
const mockReplace = vi.mocked(replaceFileAtomically);

describe('epub-zip-patcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRewrite.mockResolvedValue(undefined);
    mockReplace.mockResolvedValue(undefined);
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
  });

  it('propagates atomic replacement failures', async () => {
    mockReplace.mockRejectedValue(new Error('rename failed'));
    await expect(patch('/path/to/book.epub', new Map())).rejects.toThrow('rename failed');
  });
});
