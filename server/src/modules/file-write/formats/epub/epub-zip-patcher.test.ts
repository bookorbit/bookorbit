import { EventEmitter } from 'events';
import type { MockedFunction } from 'vitest';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as unzipper from 'unzipper';
import archiver from 'archiver';

import { patch, readEntry } from './epub-zip-patcher';

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
  default: vi.fn(() => {
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

  it('patch writes mimetype first, patches existing entries, and appends new ones', async () => {
    const opfEntry = { path: 'OPS/content.opf', stream: vi.fn(() => Buffer.from('old-opf')) };
    const chapterEntry = { path: 'OPS/ch1.xhtml', stream: vi.fn(() => Buffer.from('old-ch1')) };
    const mimetypeEntry = { path: 'mimetype', stream: vi.fn(() => Buffer.from('old-mimetype')) };

    mockOpenFile.mockResolvedValue({ files: [mimetypeEntry, opfEntry, chapterEntry] } as never);

    const patches = new Map<string, Buffer>([
      ['OPS/content.opf', Buffer.from('new-opf')],
      ['OPS/images/cover.jpg', Buffer.from('new-cover')],
    ]);

    await patch('/book.epub', patches);

    expect(archiver).toHaveBeenCalledWith('zip', { zlib: { level: 6 } });
    expect(lastArchive.append).toHaveBeenNthCalledWith(1, Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
    expect(lastArchive.append).toHaveBeenCalledWith(Buffer.from('new-opf'), { name: 'OPS/content.opf' });
    expect(lastArchive.append).toHaveBeenCalledWith(chapterEntry.stream(), { name: 'OPS/ch1.xhtml' });
    expect(lastArchive.append).toHaveBeenCalledWith(Buffer.from('new-cover'), { name: 'OPS/images/cover.jpg' });
    expect(mockRename).toHaveBeenCalledWith('/book.epub.tmp', '/book.epub');
  });

  it('deletes temp file when rename fails', async () => {
    mockOpenFile.mockResolvedValue({ files: [] } as never);
    mockRename.mockRejectedValue(new Error('rename failed'));

    await expect(patch('/book.epub', new Map())).rejects.toThrow('rename failed');
    expect(mockUnlink).toHaveBeenCalledWith('/book.epub.tmp');
  });
});
