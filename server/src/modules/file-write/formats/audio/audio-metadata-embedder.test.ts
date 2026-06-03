import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, writeFile } from 'fs/promises';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  randomUUID: vi.fn(),
  replaceFileAtomically: vi.fn(),
  sharpFactory: vi.fn(),
  sharpJpeg: vi.fn(),
  sharpToBuffer: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return { ...actual, randomUUID: mocks.randomUUID };
});

vi.mock('fs/promises', () => ({
  unlink: mocks.unlink,
  writeFile: mocks.writeFile,
}));

vi.mock('sharp', () => ({
  default: mocks.sharpFactory,
}));

vi.mock('../shared/atomic-file-replace', () => ({
  replaceFileAtomically: mocks.replaceFileAtomically,
}));

import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { AudioMetadataEmbedder, testing } from './audio-metadata-embedder';

const execFileMock = execFile as unknown as typeof mocks.execFile;
const randomUUIDMock = randomUUID as unknown as typeof mocks.randomUUID;
const writeFileMock = writeFile as unknown as typeof mocks.writeFile;
const unlinkMock = unlink as unknown as typeof mocks.unlink;
const sharpMock = sharp as unknown as typeof mocks.sharpFactory;
const replaceFileAtomicallyMock = replaceFileAtomically as unknown as typeof mocks.replaceFileAtomically;

describe('AudioMetadataEmbedder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    randomUUIDMock.mockReturnValue('fixed-id');
    mocks.sharpJpeg.mockReturnValue({ toBuffer: mocks.sharpToBuffer });
    sharpMock.mockReturnValue({ jpeg: mocks.sharpJpeg });
    mocks.sharpToBuffer.mockResolvedValue(Buffer.from('jpeg-cover'));
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, '', '');
      },
    );
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    replaceFileAtomicallyMock.mockResolvedValue(undefined);
  });

  it('writes text metadata, replaces cover when cover bytes are present, and atomically replaces the source file', async () => {
    vi.stubEnv('FFMPEG_PATH', '/opt/bin/ffmpeg');
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', {
      coverBytes: Buffer.from('raw-cover'),
      metadata: [
        { key: 'album', value: 'Dune' },
        { key: 'composer', value: 'Scott Brick' },
      ],
    });

    expect(sharpMock).toHaveBeenCalledWith(Buffer.from('raw-cover'));
    expect(mocks.sharpJpeg).toHaveBeenCalledWith({ quality: 92 });
    expect(writeFileMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg', Buffer.from('jpeg-cover'));
    expect(execFileMock).toHaveBeenCalledWith(
      '/opt/bin/ffmpeg',
      expect.arrayContaining([
        '-v',
        'error',
        '-i',
        '/books/audio/book.m4b',
        '-i',
        '/books/audio/.bookorbit-cover-fixed-id.jpg',
        '-map',
        '0:a',
        '-map',
        '0:s?',
        '-map',
        '1:v:0',
        '-map_metadata',
        '0',
        '-map_chapters',
        '0',
        '-metadata',
        'album=Dune',
        '-metadata',
        'composer=Scott Brick',
        '/books/audio/.bookorbit-write-fixed-id.m4b',
      ]),
      expect.objectContaining({ maxBuffer: expect.any(Number), timeout: 60_000 }),
      expect.any(Function),
    );
    expect(replaceFileAtomicallyMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4b', '/books/audio/book.m4b');
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('preserves existing embedded cover streams when no replacement cover is provided', async () => {
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/book.flac', 'flac', { coverBytes: null, metadata: [{ key: 'album', value: 'Book' }] });

    expect(sharpMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-map', '0', '-metadata', 'album=Book', '/books/audio/.bookorbit-write-fixed-id.flac']),
      expect.any(Object),
      expect.any(Function),
    );
    expect(unlinkMock).not.toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('ignores temporary-file cleanup failures after a successful write', async () => {
    unlinkMock.mockRejectedValue(new Error('cleanup failed'));
    const embedder = new AudioMetadataEmbedder();

    await expect(
      embedder.embedMetadata('/books/audio/book.flac', 'flac', { coverBytes: Buffer.from('raw-cover'), metadata: [] }),
    ).resolves.toBeUndefined();

    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('adds MP3-specific ID3v2 compatibility args', () => {
    const args = testing.buildFfmpegArgs('/books/audio/book.mp3', '/books/audio/cover.jpg', '/books/audio/out.mp3', 'mp3', []);

    expect(args).toContain('-id3v2_version');
    expect(args[args.indexOf('-id3v2_version') + 1]).toBe('3');
  });

  it.each(['m4b', 'm4a'])('enables extended metadata tags for %s output', (format) => {
    const args = testing.buildFfmpegArgs('/books/audio/book.m4b', null, `/books/audio/out.${format}`, format, [{ key: 'series', value: 'Series' }]);

    expect(args).toContain('-movflags');
    expect(args[args.indexOf('-movflags') + 1]).toBe('use_metadata_tags');
    expect(args.indexOf('-movflags')).toBeLessThan(args.length - 1);
  });

  it.each(['m4b', 'm4a'])('does not use extended metadata tags while replacing %s cover art', (format) => {
    const args = testing.buildFfmpegArgs('/books/audio/book.m4b', '/books/audio/cover.jpg', `/books/audio/out.${format}`, format, []);

    expect(args).not.toContain('-movflags');
  });

  it('does not enable MP4 metadata tags for non-MP4 audio output', () => {
    const args = testing.buildFfmpegArgs('/books/audio/book.flac', null, '/books/audio/out.flac', 'flac', []);

    expect(args).not.toContain('-movflags');
  });

  it('preserves source audio and subtitle streams before adding the replacement cover', () => {
    const args = testing.buildFfmpegArgs('/books/audio/book.flac', '/books/audio/cover.jpg', '/books/audio/out.flac', 'flac', []);

    expect(args).toEqual(expect.arrayContaining(['-map', '0:a', '-map', '0:s?', '-map', '1:v:0', '-disposition:v:0', 'attached_pic']));
    expect(getMapTargets(args)).toEqual(['0:a', '0:s?', '1:v:0']);
  });

  it('writes stream-scoped metadata args', () => {
    const args = testing.buildFfmpegArgs('/books/audio/book.m4b', null, '/books/audio/out.m4b', 'm4b', [
      { key: 'language', value: 'eng', specifier: 's:a:0' },
    ]);

    expect(args).toEqual(expect.arrayContaining(['-metadata:s:a:0', 'language=eng']));
  });

  it('preserves the ffmpeg error when cleanup also fails', async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(new Error('ffmpeg failed'), '', '');
      },
    );
    unlinkMock.mockRejectedValue(new Error('cleanup failed'));
    const embedder = new AudioMetadataEmbedder();

    await expect(embedder.embedMetadata('/books/audio/book.m4a', 'm4a', { coverBytes: Buffer.from('raw-cover'), metadata: [] })).rejects.toThrow(
      'ffmpeg failed',
    );

    expect(replaceFileAtomicallyMock).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4a');
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });
});

function getMapTargets(args: string[]): string[] {
  const targets: string[] = [];
  args.forEach((arg, index) => {
    if (arg === '-map') {
      targets.push(args[index + 1]!);
    }
  });
  return targets;
}
