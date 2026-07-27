import { EventEmitter } from 'events';
import { PassThrough, Readable } from 'stream';
import type { MockedFunction } from 'vitest';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import * as unzipper from 'unzipper';
import { ZipArchive } from 'archiver';

import { readComicInfoFromZip, writeComicInfoToZip } from './cbz-zip-patcher';

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

vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomUUID: vi.fn(),
  };
});

vi.mock('unzipper', () => ({
  Open: {
    file: vi.fn(),
  },
}));

let lastOutput: EventEmitter & { closed: boolean; destroy: () => void };
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
const mockRandomUuid = randomUUID as MockedFunction<typeof randomUUID>;
const mockOpenFile = unzipper.Open.file as MockedFunction<typeof unzipper.Open.file>;
const streamFrom = (value: string) => Readable.from([Buffer.from(value)]);

describe('cbz-zip-patcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRandomUuid.mockReturnValue('uuid-1234');
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    // model a real WriteStream closely enough to observe handle release ordering:
    // destroy() must be what triggers 'close', so cleanup can await it
    mockCreateWriteStream.mockImplementation(() => {
      const output = new EventEmitter() as EventEmitter & { closed: boolean; destroy: () => void };
      output.closed = false;
      output.destroy = vi.fn(() => {
        output.closed = true;
        output.emit('close');
      });
      lastOutput = output;
      return output as never;
    });
  });

  it('readComicInfoFromZip finds comicinfo case-insensitively in root or nested paths', async () => {
    mockOpenFile.mockResolvedValue({
      files: [{ path: 'pages/001.jpg' }, { path: 'META/ComicInfo.XML', buffer: vi.fn().mockResolvedValue(Buffer.from('<ComicInfo/>')) }],
    } as never);

    await expect(readComicInfoFromZip('/book.cbz')).resolves.toBe('<ComicInfo/>');
  });

  it('readComicInfoFromZip returns null when comic info is absent', async () => {
    mockOpenFile.mockResolvedValue({ files: [{ path: 'a.txt' }] } as never);

    await expect(readComicInfoFromZip('/book.cbz')).resolves.toBeNull();
  });

  it('writeComicInfoToZip preserves other entries and writes xml to existing comic info path', async () => {
    const existingEntry = {
      path: 'metadata/ComicInfo.xml',
      stream: vi.fn(() => streamFrom('oldxml')),
    };
    const imageEntry = {
      path: 'pages/001.jpg',
      stream: vi.fn(() => streamFrom('img')),
    };

    mockOpenFile.mockResolvedValue({ files: [existingEntry, imageEntry] } as never);

    await writeComicInfoToZip('/books/a.cbz', '<ComicInfo><Title>New</Title></ComicInfo>');

    expect(ZipArchive).toHaveBeenCalledWith({ zlib: { level: 6 } });
    expect(imageEntry.stream).toHaveBeenCalledTimes(1);
    expect(lastArchive.append).toHaveBeenCalledWith(expect.objectContaining({ pipe: expect.any(Function) }), { name: 'pages/001.jpg' });
    expect(lastArchive.append).toHaveBeenCalledWith(Buffer.from('<ComicInfo><Title>New</Title></ComicInfo>', 'utf-8'), {
      name: 'metadata/ComicInfo.xml',
    });
    expect(mockRename).toHaveBeenCalledWith('/books/.cbx-write-uuid-1234', '/books/a.cbz');
  });

  it('rejects when a source entry stream errors while patching', async () => {
    const sourceError = Object.assign(new Error('ENOENT: no such file or directory, open /books/a.cbz'), { code: 'ENOENT' });
    const imageEntry = {
      path: 'pages/001.jpg',
      stream: vi.fn(() => {
        const source = new PassThrough();
        process.nextTick(() => source.emit('error', sourceError));
        return source;
      }),
    };
    mockOpenFile.mockResolvedValue({ files: [imageEntry] } as never);

    await expect(writeComicInfoToZip('/books/a.cbz', '<ComicInfo/>')).rejects.toThrow('ENOENT');

    expect(imageEntry.stream).toHaveBeenCalledTimes(1);
    expect(mockRename).not.toHaveBeenCalled();
    // the archive never reached the atomic replace, so the partial temp file must
    // still be cleaned up here rather than left next to the book
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.cbx-write-uuid-1234'));
    // and the writer must be closed first, or the unlink fails on an open handle
    // and gets swallowed by best-effort cleanup
    expect(lastOutput.destroy).toHaveBeenCalled();
    expect((lastOutput.destroy as unknown as vi.Mock).mock.invocationCallOrder[0]).toBeLessThan(mockUnlink.mock.invocationCallOrder[0]);
  });

  it('deletes temp archive when rename fails', async () => {
    mockOpenFile.mockResolvedValue({ files: [] } as never);
    mockRename.mockRejectedValue(new Error('cross-device link'));

    await expect(writeComicInfoToZip('/books/a.cbz', '<ComicInfo/>')).rejects.toThrow('cross-device link');

    expect(mockUnlink).toHaveBeenCalledWith('/books/.cbx-write-uuid-1234');
  });
});
