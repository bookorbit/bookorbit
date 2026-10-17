import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { unlink, writeFile } from 'fs/promises';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  randomUUID: vi.fn(),
  replaceFileAtomically: vi.fn(),
  runFfmpeg: vi.fn(),
  sharpFactory: vi.fn(),
  sharpJpeg: vi.fn(),
  sharpToBuffer: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
  writeMp4FreeformTags: vi.fn(),
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

vi.mock('./ffmpeg-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ffmpeg-runner')>()),
  runFfmpeg: mocks.runFfmpeg,
}));

vi.mock('./mp4-freeform-tags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mp4-freeform-tags')>()),
  writeMp4FreeformTags: mocks.writeMp4FreeformTags,
}));

import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { AudioMetadataEmbedder, testing } from './audio-metadata-embedder';
import { FfmpegStalledError } from './ffmpeg-runner';

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
    mocks.runFfmpeg.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    replaceFileAtomicallyMock.mockResolvedValue(undefined);
    mocks.writeMp4FreeformTags.mockResolvedValue(undefined);
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
    expect(mocks.runFfmpeg).toHaveBeenCalledWith(
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
    );
    expect(replaceFileAtomicallyMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4b', '/books/audio/book.m4b');
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('converts one shared cover to JPEG once across every track of a run', async () => {
    const embedder = new AudioMetadataEmbedder();
    const sharedCover = Buffer.from('png-cover');

    for (const track of ['01', '02', '03']) {
      await embedder.embedMetadata(`/books/audio/${track}.mp3`, 'mp3', { coverBytes: sharedCover, metadata: [] });
    }

    expect(sharpMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(3);
    expect(writeFileMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg', Buffer.from('jpeg-cover'));
  });

  it('converts a different cover buffer again rather than reusing an earlier run', async () => {
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/a.mp3', 'mp3', { coverBytes: Buffer.from('first'), metadata: [] });
    await embedder.embedMetadata('/books/audio/b.mp3', 'mp3', { coverBytes: Buffer.from('second'), metadata: [] });

    expect(sharpMock).toHaveBeenCalledTimes(2);
  });

  it('preserves existing embedded cover streams when no replacement cover is provided', async () => {
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/book.flac', 'flac', { coverBytes: null, metadata: [{ key: 'album', value: 'Book' }] });

    expect(sharpMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    const args = mocks.runFfmpeg.mock.calls[0]![1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-metadata', 'album=Book', '/books/audio/.bookorbit-write-fixed-id.flac']));
    // Audio, existing art, and subtitles only: a copied MP4 chapter data track fails the whole write.
    expect(mapArgs(args)).toEqual(['0:a', '0:v?', '0:s?']);
    expect(unlinkMock).not.toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('never maps data streams, with or without a replacement cover', () => {
    expect(mapArgs(testing.buildFfmpegArgs('/a.m4b', null, '/t.m4b', 'm4b', []))).toEqual(['0:a', '0:v?', '0:s?']);
    expect(mapArgs(testing.buildFfmpegArgs('/a.m4b', '/c.jpg', '/t.m4b', 'm4b', []))).toEqual(['0:a', '0:s?', '1:v:0']);
  });

  it('bounds the ffprobe stream check and treats a timed-out probe as having art', async () => {
    vi.stubEnv('FFPROBE_PATH', '/opt/bin/ffprobe');
    execFileMock.mockImplementation((_bin: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
      callback(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }), '');
    });
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', { coverBytes: null, metadata: [{ key: 'album', value: 'Book' }] });

    const probeCall = execFileMock.mock.calls.find(([bin]) => bin === '/opt/bin/ffprobe')!;
    expect(probeCall[2]).toEqual({ timeout: 30_000 });
    expect(ffmpegArgs()).not.toContain('use_metadata_tags');
    expect(ffmpegArgs()).not.toContain('-f');
  });

  function mockProbedStreams(streams: Array<{ codec_type: string; codec_name?: string }>): void {
    mockProbeOutput(JSON.stringify({ streams }));
  }

  function mockProbeOutput(stdout: string): void {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout, stderr: '' });
      },
    );
  }

  function ffmpegArgs(): string[] {
    return mocks.runFfmpeg.mock.calls[0]![1] as string[];
  }

  function mapArgs(args: string[]): string[] {
    return args.flatMap((arg, index) => (arg === '-map' ? [args[index + 1]!] : []));
  }

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

  it('writes the tags the iTunes mode drops as freeform atoms before replacing the file', async () => {
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', {
      coverBytes: Buffer.from('raw-cover'),
      metadata: [
        { key: 'album', value: 'Dune' },
        { key: 'subtitle', value: 'Book One' },
        { key: 'series-part', value: '' },
        { key: 'language', value: 'eng', specifier: 's:a:0' },
      ],
    });

    expect(mocks.writeMp4FreeformTags).toHaveBeenCalledWith(
      '/books/audio/.bookorbit-write-fixed-id.m4b',
      [
        { name: 'SUBTITLE', value: 'Book One' },
        { name: 'SERIES-PART', value: '' },
      ],
      { carryOverFrom: '/books/audio/book.m4b' },
    );
    expect(mocks.writeMp4FreeformTags.mock.invocationCallOrder[0]).toBeLessThan(replaceFileAtomicallyMock.mock.invocationCallOrder[0]!);
  });

  it('adds freeform atoms when keeping existing art in an MP4', async () => {
    mockProbedStreams([
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'video', codec_name: 'mjpeg' },
    ]);
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/book.m4a', 'm4a', { coverBytes: null, metadata: [{ key: 'publisher', value: 'Ace' }] });

    expect(mocks.writeMp4FreeformTags).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4a', [{ name: 'PUBLISHER', value: 'Ace' }], {
      carryOverFrom: '/books/audio/book.m4a',
    });
  });

  it('leaves extended tags to FFmpeg when it writes QuickTime metadata keys', async () => {
    mockProbedStreams([{ codec_type: 'audio', codec_name: 'aac' }]);
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', { coverBytes: null, metadata: [{ key: 'subtitle', value: 'Book One' }] });

    expect(ffmpegArgs()).toContain('use_metadata_tags');
    expect(mocks.writeMp4FreeformTags).not.toHaveBeenCalled();
  });

  describe('MP4 output muxer', () => {
    it.each(['mp3', 'mp2', 'opus', 'flac', 'eac3'])('writes %s audio with the mp4 muxer, which the ipod muxer rejects', (codec) => {
      expect(testing.outputMuxer('m4b', [{ codecType: 'audio', codecName: codec }])).toBe('mp4');
      expect(testing.outputMuxer('m4a', [{ codecType: 'audio', codecName: codec }])).toBe('mp4');
    });

    it.each(['aac', 'alac', 'ac3'])('leaves %s audio to the ipod muxer FFmpeg picks for the file name', (codec) => {
      expect(
        testing.outputMuxer('m4b', [
          { codecType: 'audio', codecName: codec },
          { codecType: 'video', codecName: 'mjpeg' },
          { codecType: 'data', codecName: 'bin_data' },
        ]),
      ).toBeUndefined();
    });

    it('uses the mp4 muxer when any audio stream is one the ipod muxer rejects', () => {
      expect(
        testing.outputMuxer('m4b', [
          { codecType: 'audio', codecName: 'aac' },
          { codecType: 'audio', codecName: 'mp3' },
        ]),
      ).toBe('mp4');
    });

    it('uses the mp4 muxer for audio FFmpeg could not name', () => {
      expect(testing.outputMuxer('m4b', [{ codecType: 'audio', codecName: null }])).toBe('mp4');
    });

    it('leaves the muxer alone when the streams are unknown or the format is not MP4', () => {
      expect(testing.outputMuxer('m4b', null)).toBeUndefined();
      expect(testing.outputMuxer('mp3', [{ codecType: 'audio', codecName: 'mp3' }])).toBeUndefined();
      expect(testing.outputMuxer('flac', [{ codecType: 'audio', codecName: 'flac' }])).toBeUndefined();
    });

    it('names the muxer immediately before the output path', () => {
      const args = testing.buildFfmpegArgs('/a.m4b', '/c.jpg', '/t.m4b', 'm4b', [{ key: 'album', value: 'Book' }], { muxer: 'mp4' });

      expect(args.slice(-3)).toEqual(['-f', 'mp4', '/t.m4b']);
      expect(testing.buildFfmpegArgs('/a.m4b', '/c.jpg', '/t.m4b', 'm4b', [])).not.toContain('-f');
    });

    it('probes an MP4 being given a new cover and writes its MP3 audio with the mp4 muxer', async () => {
      mockProbedStreams([
        { codec_type: 'audio', codec_name: 'mp3' },
        { codec_type: 'data', codec_name: 'bin_data' },
        { codec_type: 'video', codec_name: 'mjpeg' },
      ]);
      const embedder = new AudioMetadataEmbedder();

      await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', {
        coverBytes: Buffer.from('raw-cover'),
        metadata: [{ key: 'subtitle', value: 'Book One' }],
      });

      expect(execFileMock).toHaveBeenCalledWith(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', '/books/audio/book.m4b'],
        { timeout: 30_000 },
        expect.any(Function),
      );
      expect(ffmpegArgs().slice(-3)).toEqual(['-f', 'mp4', '/books/audio/.bookorbit-write-fixed-id.m4b']);
      expect(ffmpegArgs()).not.toContain('use_metadata_tags');
      expect(mocks.writeMp4FreeformTags).toHaveBeenCalledWith(
        '/books/audio/.bookorbit-write-fixed-id.m4b',
        [{ name: 'SUBTITLE', value: 'Book One' }],
        {
          carryOverFrom: '/books/audio/book.m4b',
        },
      );
      expect(replaceFileAtomicallyMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4b', '/books/audio/book.m4b');
    });

    it('writes an artless MP3 M4B with the mp4 muxer and FFmpeg metadata keys together', async () => {
      mockProbedStreams([{ codec_type: 'audio', codec_name: 'mp3' }]);
      const embedder = new AudioMetadataEmbedder();

      await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', { coverBytes: null, metadata: [{ key: 'subtitle', value: 'Book One' }] });

      expect(ffmpegArgs()).toContain('use_metadata_tags');
      expect(ffmpegArgs().slice(-3)).toEqual(['-f', 'mp4', '/books/audio/.bookorbit-write-fixed-id.m4b']);
      expect(mocks.writeMp4FreeformTags).not.toHaveBeenCalled();
    });

    it('keeps the ipod muxer for an AAC M4B', async () => {
      mockProbedStreams([
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'video', codec_name: 'mjpeg' },
      ]);
      const embedder = new AudioMetadataEmbedder();

      await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', { coverBytes: Buffer.from('raw-cover'), metadata: [] });

      expect(ffmpegArgs()).not.toContain('-f');
    });

    it.each([
      ['not JSON', 'Invalid data found when processing input'],
      ['without a stream list', '{}'],
    ])('treats probe output %s as unknown streams', async (_label, stdout) => {
      mockProbeOutput(stdout);
      const embedder = new AudioMetadataEmbedder();

      await embedder.embedMetadata('/books/audio/book.m4b', 'm4b', { coverBytes: null, metadata: [{ key: 'subtitle', value: 'Book One' }] });

      expect(ffmpegArgs()).not.toContain('-f');
      expect(ffmpegArgs()).not.toContain('use_metadata_tags');
      expect(mocks.writeMp4FreeformTags).toHaveBeenCalled();
    });

    it.each(['mp3', 'flac'])('never probes a %s file', async (format) => {
      const embedder = new AudioMetadataEmbedder();

      await embedder.embedMetadata(`/books/audio/book.${format}`, format, { coverBytes: null, metadata: [] });

      expect(execFileMock).not.toHaveBeenCalled();
      expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
    });
  });

  it.each(['mp3', 'flac'])('never edits MP4 atoms in %s files', async (format) => {
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata(`/books/audio/book.${format}`, format, {
      coverBytes: Buffer.from('raw-cover'),
      metadata: [{ key: 'subtitle', value: 'x' }],
    });

    expect(mocks.writeMp4FreeformTags).not.toHaveBeenCalled();
  });

  it('keeps the original file when the freeform tags cannot be written', async () => {
    mocks.writeMp4FreeformTags.mockRejectedValue(new Error('MP4 movie box is not at the end of the file'));
    const embedder = new AudioMetadataEmbedder();

    await expect(
      embedder.embedMetadata('/books/audio/book.m4b', 'm4b', { coverBytes: Buffer.from('raw-cover'), metadata: [{ key: 'subtitle', value: 'x' }] }),
    ).rejects.toThrow('MP4 movie box is not at the end of the file');

    expect(replaceFileAtomicallyMock).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4b');
  });

  it('keeps the original file and removes the partial output when ffmpeg stalls', async () => {
    mocks.runFfmpeg.mockRejectedValue(new FfmpegStalledError(120_000, 'SIGTERM'));
    const embedder = new AudioMetadataEmbedder();

    await expect(
      embedder.embedMetadata('/books/audio/book.m4b', 'm4b', { coverBytes: Buffer.from('raw-cover'), metadata: [] }),
    ).rejects.toBeInstanceOf(FfmpegStalledError);

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
    expect(mocks.writeMp4FreeformTags).not.toHaveBeenCalled();
    expect(replaceFileAtomicallyMock).not.toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4b');
    expect(unlinkMock).toHaveBeenCalledWith('/books/audio/.bookorbit-cover-fixed-id.jpg');
  });

  it('retries an unprobed MP4 with the mp4 muxer when the ipod muxer refuses it', async () => {
    mockProbeOutput('not json');
    mocks.runFfmpeg.mockRejectedValueOnce(new Error("Tag mp4a incompatible with output codec id '86017'")).mockResolvedValueOnce(undefined);
    const embedder = new AudioMetadataEmbedder();

    await embedder.embedMetadata('/books/audio/merged.m4b', 'm4b', { coverBytes: Buffer.from('raw-cover'), metadata: [] });

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2);
    expect(mocks.runFfmpeg.mock.calls[0]![1]).not.toContain('-f');
    expect(mocks.runFfmpeg.mock.calls[1]![1]).toEqual(expect.arrayContaining(['-f', 'mp4', '/books/audio/.bookorbit-write-fixed-id.m4b']));
    expect(replaceFileAtomicallyMock).toHaveBeenCalledWith('/books/audio/.bookorbit-write-fixed-id.m4b', '/books/audio/merged.m4b');
  });

  it('reports the first ffmpeg failure when the mp4 retry fails as well', async () => {
    mockProbeOutput('not json');
    mocks.runFfmpeg.mockRejectedValueOnce(new Error('first failure')).mockRejectedValueOnce(new Error('retry failure'));
    const embedder = new AudioMetadataEmbedder();

    await expect(embedder.embedMetadata('/books/audio/merged.m4a', 'm4a', { coverBytes: null, metadata: [] })).rejects.toThrow('first failure');

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2);
    expect(replaceFileAtomicallyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a probed MP4', 'm4b', true],
    ['an MP3', 'mp3', false],
  ])('does not retry a failed write of %s', async (_label, format, probed) => {
    if (probed) mockProbedStreams([{ codec_type: 'audio', codec_name: 'aac' }]);
    mocks.runFfmpeg.mockRejectedValue(new Error('ffmpeg failed'));
    const embedder = new AudioMetadataEmbedder();

    await expect(embedder.embedMetadata(`/books/audio/book.${format}`, format, { coverBytes: null, metadata: [] })).rejects.toThrow('ffmpeg failed');

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
  });

  it('preserves the ffmpeg error when cleanup also fails', async () => {
    mocks.runFfmpeg.mockRejectedValue(new Error('ffmpeg failed'));
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
