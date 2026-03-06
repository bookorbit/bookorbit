import { EventEmitter } from 'events';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import * as unzipper from 'unzipper';
import archiver from 'archiver';

import { readComicInfoFromZip, writeComicInfoToZip } from './cbz-zip-patcher';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    createWriteStream: jest.fn(),
  };
});

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    rename: jest.fn(),
    unlink: jest.fn(),
  };
});

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomUUID: jest.fn(),
  };
});

jest.mock('unzipper', () => ({
  Open: {
    file: jest.fn(),
  },
}));

let lastArchive: EventEmitter & {
  append: jest.Mock;
  pipe: jest.Mock;
  finalize: jest.Mock;
};

jest.mock('archiver', () =>
  jest.fn(() => {
    let output: EventEmitter | null = null;
    const emitter = new EventEmitter() as EventEmitter & {
      append: jest.Mock;
      pipe: jest.Mock;
      finalize: jest.Mock;
    };
    emitter.append = jest.fn();
    emitter.pipe = jest.fn((out: EventEmitter) => {
      output = out;
    });
    emitter.finalize = jest.fn(() => {
      setImmediate(() => output?.emit('close'));
    });
    lastArchive = emitter;
    return emitter;
  }),
);

const mockCreateWriteStream = createWriteStream as jest.MockedFunction<typeof createWriteStream>;
const mockRename = fs.rename as jest.MockedFunction<typeof fs.rename>;
const mockUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>;
const mockRandomUuid = randomUUID as jest.MockedFunction<typeof randomUUID>;
const mockOpenFile = unzipper.Open.file as jest.MockedFunction<typeof unzipper.Open.file>;

describe('cbz-zip-patcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRandomUuid.mockReturnValue('uuid-1234');
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockCreateWriteStream.mockImplementation(() => new EventEmitter() as never);
  });

  it('readComicInfoFromZip finds comicinfo case-insensitively in root or nested paths', async () => {
    mockOpenFile.mockResolvedValue({
      files: [
        { path: 'pages/001.jpg' },
        { path: 'META/ComicInfo.XML', buffer: jest.fn().mockResolvedValue(Buffer.from('<ComicInfo/>')) },
      ],
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
      stream: jest.fn(() => Buffer.from('oldxml')),
    };
    const imageEntry = {
      path: 'pages/001.jpg',
      stream: jest.fn(() => Buffer.from('img')),
    };

    mockOpenFile.mockResolvedValue({ files: [existingEntry, imageEntry] } as never);

    await writeComicInfoToZip('/books/a.cbz', '<ComicInfo><Title>New</Title></ComicInfo>');

    expect(archiver).toHaveBeenCalledWith('zip', { zlib: { level: 6 } });
    expect(lastArchive.append).toHaveBeenCalledWith(imageEntry.stream(), { name: 'pages/001.jpg' });
    expect(lastArchive.append).toHaveBeenCalledWith(Buffer.from('<ComicInfo><Title>New</Title></ComicInfo>', 'utf-8'), {
      name: 'metadata/ComicInfo.xml',
    });
    expect(mockRename).toHaveBeenCalledWith('/books/.cbx-write-uuid-1234', '/books/a.cbz');
  });

  it('deletes temp archive when rename fails', async () => {
    mockOpenFile.mockResolvedValue({ files: [] } as never);
    mockRename.mockRejectedValue(new Error('cross-device link'));

    await expect(writeComicInfoToZip('/books/a.cbz', '<ComicInfo/>')).rejects.toThrow('cross-device link');

    expect(mockUnlink).toHaveBeenCalledWith('/books/.cbx-write-uuid-1234');
  });
});
