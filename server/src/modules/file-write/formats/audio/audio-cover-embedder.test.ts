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

import { AudioCoverEmbedder, testing } from './audio-cover-embedder';
import { replaceFileAtomically } from '../shared/atomic-file-replace';

const execFileMock = execFile as unknown as typeof mocks.execFile;
const randomUUIDMock = randomUUID as unknown as typeof mocks.randomUUID;
const writeFileMock = writeFile as unknown as typeof mocks.writeFile;
const unlinkMock = unlink as unknown as typeof mocks.unlink;
const sharpMock = sharp as unknown as typeof mocks.sharpFactory;
const replaceFileAtomicallyMock = replaceFileAtomically as unknown as typeof mocks.replaceFileAtomically;

describe('AudioCoverEmbedder', () => {
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

  it('normalizes cover bytes to JPEG, embeds them with ffmpeg, and atomically replaces the source file', async () => {
    vi.stubEnv('FFMPEG_PATH', '/opt/bin/ffmpeg');
    const embedder = new AudioCoverEmbedder();

    await embedder.embedCover('/books/audio/book.m4b', Buffer.from('raw-cover'), 'm4b');

    expect(sharpMock).toHaveBeenCalledWith(Buffer.from('raw-cover'));
    expect(mocks.sharpJpeg).toHaveBeenCalledWith({ quality: 92 });
    expect(writeFileMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg', Buffer.from('jpeg-cover'));
    expect(execFileMock).toHaveBeenCalledWith(
      '/opt/bin/ffmpeg',
      expect.arrayContaining([
        '-i',
        '/books/audio/book.m4b',
        '-i',
        '/books/audio/.bookorbit-cover-fixed-id.jpg',
        '-map',
        '0:a',
        '-map_metadata',
        '0',
        '-map_chapters',
        '0',
        '/books/audio/.bookorbit-write-fixed-id.m4b',
      ]),
      expect.objectContaining({ maxBuffer: expect.any(Number), timeout: 60_000 }),
      expect.any(Function),
    );
    expect(replaceFileAtomicallyMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4b', '/books/audio/book.m4b');
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('falls back to the ffmpeg binary on PATH when no override is configured', async () => {
    const embedder = new AudioCoverEmbedder();

    await embedder.embedCover('/books/audio/book.flac', Buffer.from('raw-cover'), 'flac');

    expect(execFileMock).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['/books/audio/book.flac', '/books/audio/.bookorbit-write-fixed-id.flac']),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('ignores missing temporary files during cleanup', async () => {
    unlinkMock.mockRejectedValue(Object.assign(new Error('already removed'), { code: 'ENOENT' }));
    const embedder = new AudioCoverEmbedder();

    await expect(embedder.embedCover('/books/audio/book.flac', Buffer.from('raw-cover'), 'flac')).resolves.toBeUndefined();

    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('adds MP3-specific ID3v2 compatibility args', () => {
    const args = testing.buildFfmpegArgs('/books/audio/book.mp3', '/books/audio/cover.jpg', '/books/audio/out.mp3', 'mp3');

    expect(args).toContain('-id3v2_version');
    expect(args[args.indexOf('-id3v2_version') + 1]).toBe('3');
  });

  it('maps only source audio streams before adding the replacement cover', () => {
    const args = testing.buildFfmpegArgs('/books/audio/book.flac', '/books/audio/cover.jpg', '/books/audio/out.flac', 'flac');

    expect(args).toEqual(expect.arrayContaining(['-map', '0:a', '-map', '1:v:0', '-disposition:v:0', 'attached_pic']));
    expect(getMapTargets(args)).toEqual(['0:a', '1:v:0']);
  });

  it('cleans both temporary files when ffmpeg fails', async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(new Error('ffmpeg failed'), '', '');
      },
    );
    const embedder = new AudioCoverEmbedder();

    await expect(embedder.embedCover('/books/audio/book.m4a', Buffer.from('raw-cover'), 'm4a')).rejects.toThrow('ffmpeg failed');

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
