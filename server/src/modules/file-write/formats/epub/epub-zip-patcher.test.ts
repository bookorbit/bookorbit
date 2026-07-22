import { EventEmitter } from 'events';
import { PassThrough, Readable } from 'stream';
import type { MockedFunction } from 'vitest';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as unzipper from 'unzipper';
import { ZipArchive } from 'archiver';

import { listEntryPaths, patch, readEntry } from './epub-zip-patcher';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    createWriteStream: vi.fn(),
  };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    rename: vi.fn(),
    unlink: vi.fn(),
  };
});

vi.mock('unzipper', () => ({
  Open: {
    file: vi.fn(),
  },
}));

let lastArchive: EventEmitter & {
  append: vi.Mock;
  pipe: vi.Mock;
  finalize: vi.Mock;
};

vi.mock('archiver', () => ({
  ZipArchive: vi.fn(function () {
    let output: EventEmitter | null = null;
    const emitter = new EventEmitter() as EventEmitter & {
      append: vi.Mock;
      pipe: vi.Mock;
      finalize: vi.Mock;
    };
    emitter.append = vi.fn();
    emitter.pipe = vi.fn((out: EventEmitter) => {
      output = out;
    });
    emitter.finalize = vi.fn(() => {
      setImmediate(() => output?.emit('close'));
    });
    lastArchive = emitter;
    return emitter;
  }),
}));

const mockCreateWriteStream = createWriteStream as MockedFunction<typeof createWriteStream>;
const mockRename = fs.rename as MockedFunction<typeof fs.rename>;
const mockUnlink = fs.unlink as MockedFunction<typeof fs.unlink>;
const mockOpenFile = unzipper.Open.file as MockedFunction<typeof unzipper.Open.file>;
const streamFrom = (value: string) => Readable.from([Buffer.from(value)]);

describe('epub-zip-patcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWriteStream.mockImplementation(() => new EventEmitter() as never);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  it('readEntry returns UTF-8 text for existing entry', async () => {
    mockOpenFile.mockResolvedValue({
      files: [{ path: 'OPS/content.opf', buffer: vi.fn().mockResolvedValue(Buffer.from('<package/>')) }],
    } as never);

    await expect(readEntry('/book.epub', 'OPS/content.opf')).resolves.toBe('<package/>');
  });

  it('readEntry throws for missing entry', async () => {
    mockOpenFile.mockResolvedValue({ files: [] } as never);

    await expect(readEntry('/book.epub', 'OPS/content.opf')).rejects.toThrow('Entry not found in EPUB: OPS/content.opf');
  });

  it('lists every occupied archive entry path', async () => {
    mockOpenFile.mockResolvedValue({
      files: [{ path: 'mimetype' }, { path: 'OPS/content.opf' }, { path: 'OPS/images/cover.webp' }],
    } as never);

    await expect(listEntryPaths('/book.epub')).resolves.toEqual(['mimetype', 'OPS/content.opf', 'OPS/images/cover.webp']);
  });

  it('patch writes mimetype first, patches existing entries, and appends new ones', async () => {
    const opfEntry = { path: 'OPS/content.opf', stream: vi.fn(() => Buffer.from('old-opf')) };
    const chapterEntry = { path: 'OPS/ch1.xhtml', stream: vi.fn(() => streamFrom('old-ch1')) };
    const mimetypeEntry = { path: 'mimetype', stream: vi.fn(() => streamFrom('old-mimetype')) };

    mockOpenFile.mockResolvedValue({ files: [mimetypeEntry, opfEntry, chapterEntry] } as never);

    const patches = new Map<string, Buffer>([
      ['OPS/content.opf', Buffer.from('new-opf')],
      ['OPS/images/cover.jpg', Buffer.from('new-cover')],
    ]);

    await patch('/book.epub', patches);

    expect(ZipArchive).toHaveBeenCalledWith({ zlib: { level: 6 } });
    expect(lastArchive.append).toHaveBeenNthCalledWith(1, Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
    expect(lastArchive.append).toHaveBeenCalledWith(Buffer.from('new-opf'), { name: 'OPS/content.opf' });
    expect(chapterEntry.stream).toHaveBeenCalledTimes(1);
    expect(lastArchive.append).toHaveBeenCalledWith(expect.objectContaining({ pipe: expect.any(Function) }), { name: 'OPS/ch1.xhtml' });
    expect(lastArchive.append).toHaveBeenCalledWith(Buffer.from('new-cover'), { name: 'OPS/images/cover.jpg' });
    expect(mockRename).toHaveBeenCalledWith('/book.epub.tmp', '/book.epub');
  });

  it('rejects when a source entry stream errors while patching', async () => {
    const sourceError = Object.assign(new Error('ENOENT: no such file or directory, open /book.epub'), { code: 'ENOENT' });
    const missingEntry = {
      path: 'OPS/ch1.xhtml',
      stream: vi.fn(() => {
        const source = new PassThrough();
        process.nextTick(() => source.emit('error', sourceError));
        return source;
      }),
    };
    mockOpenFile.mockResolvedValue({ files: [missingEntry] } as never);

    await expect(patch('/book.epub', new Map())).rejects.toThrow('ENOENT');

    expect(missingEntry.stream).toHaveBeenCalledTimes(1);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('deletes temp file when rename fails', async () => {
    mockOpenFile.mockResolvedValue({ files: [] } as never);
    mockRename.mockRejectedValue(new Error('rename failed'));

    await expect(patch('/book.epub', new Map())).rejects.toThrow('rename failed');
    expect(mockUnlink).toHaveBeenCalledWith('/book.epub.tmp');
  });
});
