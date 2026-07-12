import { execFile as execFileCallback } from 'child_process';
import { copyFile, chmod, mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import { createRequire } from 'module';

import { createBookWriteFieldMask } from '../../file-write.constants';
import { M4aAudioFormatWriter, M4bAudioFormatWriter, Mp3AudioFormatWriter } from './audio-format-writer';
import { AudioMetadataEmbedder } from './audio-metadata-embedder';

const execFile = promisify(execFileCallback);
const requireInstaller = createRequire(__filename);

interface InstallerPackage {
  path: string;
}

describe('audio metadata round-trip', () => {
  let tempDir: string;
  let ffmpegPath: string;
  let ffprobePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bookorbit-audio-roundtrip-'));
    const ffmpegInstaller = requireInstaller('@ffmpeg-installer/ffmpeg') as InstallerPackage;
    const ffprobeInstaller = requireInstaller('@ffprobe-installer/ffprobe') as InstallerPackage;
    ffmpegPath = ffmpegInstaller.path;
    ffprobePath = join(tempDir, 'ffprobe');
    await copyFile(ffprobeInstaller.path, ffprobePath);
    await chmod(ffprobePath, 0o755);
    vi.stubEnv('FFMPEG_PATH', ffmpegPath);
    vi.stubEnv('FFPROBE_PATH', ffprobePath);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes tags with ffmpeg and rescans them with the audio extractor', async () => {
    const filePath = join(tempDir, 'fixture.mp3');
    await generateAudioFixture(filePath);

    const writer = new Mp3AudioFormatWriter(new AudioMetadataEmbedder());
    await writer.write(
      filePath,
      {
        title: 'Roundtrip Title',
        subtitle: 'Roundtrip Subtitle',
        authors: [{ name: 'Author One', sortName: null }],
        narrators: ['Narrator One'],
        publisher: 'Roundtrip Publisher',
        publishedYear: 2025,
        description: 'Roundtrip Description',
        genres: ['Fantasy', 'Adventure'],
        language: 'eng',
        seriesName: 'Roundtrip Series',
        seriesIndex: 4,
        audibleId: 'B0ROUNDTRIP',
        librofmId: '9781234567890',
      },
      { dryRun: false, fieldMask: createBookWriteFieldMask() },
    );

    const tags = await probeFormatTags(filePath);
    expect(tags.album).toBe('Roundtrip Title');
    expect(tags.title).toBe('Roundtrip Title');
    expect(tags.subtitle).toBe('Roundtrip Subtitle');
    expect(tags.album_artist ?? tags.albumartist).toBe('Author One');
    expect(tags.artist).toBe('Author One');
    expect(tags.composer).toBe('Narrator One');
    expect(tags.publisher).toBe('Roundtrip Publisher');
    expect(tags.date ?? tags.year).toContain('2025');
    expect(tags.description ?? tags.comment).toBe('Roundtrip Description');
    expect(tags.genre).toBe('Fantasy; Adventure');
    expect(tags.series).toBe('Roundtrip Series');
    expect(tags['series-part']).toBe('4');
    expect(tags.asin ?? tags.audible_asin).toBe('B0ROUNDTRIP');
    expect(tags.librofm_isbn).toBe('9781234567890');

    vi.resetModules();
    const { extractAudioMetadata } = await import('../../../metadata/extractors/audio.extractor');
    const extracted = await extractAudioMetadata(filePath);

    expect(extracted).toEqual(
      expect.objectContaining({
        title: 'Roundtrip Title',
        subtitle: 'Roundtrip Subtitle',
        narrators: ['Narrator One'],
        publisher: 'Roundtrip Publisher',
        publishedYear: 2025,
        description: 'Roundtrip Description',
        language: 'eng',
        seriesName: 'Roundtrip Series',
        seriesIndex: 4,
        genres: ['Fantasy', 'Adventure'],
        audibleId: 'B0ROUNDTRIP',
        librofmId: '9781234567890',
      }),
    );
    expect(extracted.authors).toEqual([{ name: 'Author One', sortName: null }]);
  });

  it.each([
    ['m4b', M4bAudioFormatWriter],
    ['m4a', M4aAudioFormatWriter],
  ] as const)('round-trips extended metadata for %s files', async (format, Writer) => {
    const filePath = join(tempDir, `fixture.${format}`);
    await generateAudioFixture(filePath, 'aac');

    const writer = new Writer(new AudioMetadataEmbedder());
    await writer.write(
      filePath,
      {
        title: 'Extended Title',
        subtitle: 'Extended Subtitle',
        authors: [{ name: 'Author One', sortName: null }],
        narrators: ['Narrator One', 'Narrator Two'],
        publisher: 'Extended Publisher',
        publishedYear: 2026,
        description: 'Extended Description',
        genres: ['Sci-Fi', 'Adventure'],
        language: 'eng',
        seriesName: 'Extended Series',
        seriesIndex: 7,
        audibleId: 'B0EXTENDED',
        librofmId: '9780987654321',
      },
      { dryRun: false, fieldMask: createBookWriteFieldMask() },
    );

    const tags = await probeFormatTags(filePath);
    expect(tags.album).toBe('Extended Title');
    expect(tags.title).toBe('Extended Title');
    expect(tags.subtitle).toBe('Extended Subtitle');
    expect(tags.album_artist ?? tags.albumartist).toBe('Author One');
    expect(tags.artist).toBe('Author One');
    expect(tags.composer).toBe('Narrator One; Narrator Two');
    expect(tags.publisher).toBe('Extended Publisher');
    expect(tags.year ?? tags.date).toContain('2026');
    expect(tags.language).toBe('eng');
    expect(tags.series).toBe('Extended Series');
    expect(tags['series-part']).toBe('7');
    expect(tags.asin ?? tags.audible_asin).toBe('B0EXTENDED');
    expect(tags.librofm_isbn).toBe('9780987654321');

    vi.resetModules();
    const { extractAudioMetadata } = await import('../../../metadata/extractors/audio.extractor');
    const extracted = await extractAudioMetadata(filePath);

    expect(extracted).toEqual(
      expect.objectContaining({
        title: 'Extended Title',
        subtitle: 'Extended Subtitle',
        narrators: ['Narrator One', 'Narrator Two'],
        publisher: 'Extended Publisher',
        publishedYear: 2026,
        language: 'eng',
        seriesName: 'Extended Series',
        seriesIndex: 7,
        audibleId: 'B0EXTENDED',
        librofmId: '9780987654321',
      }),
    );
    expect(extracted.authors).toEqual([{ name: 'Author One', sortName: null }]);
  });

  it.each([
    ['m4b', M4bAudioFormatWriter],
    ['m4a', M4aAudioFormatWriter],
  ] as const)('writes cover art that remains extractable from %s files', async (format, Writer) => {
    const filePath = join(tempDir, `fixture.${format}`);
    const coverPath = join(tempDir, 'cover.jpg');
    await generateAudioFixture(filePath, 'aac');
    await generateCoverFixture(coverPath);

    const writer = new Writer(new AudioMetadataEmbedder());
    await writer.write(
      filePath,
      {
        title: 'Covered Title',
        coverBytes: await readFile(coverPath),
      },
      { dryRun: false, fieldMask: createBookWriteFieldMask() },
    );

    const streams = await probeStreams(filePath);
    const coverStream = streams.find((stream) => stream.codec_type === 'video');
    expect(coverStream).toEqual(expect.objectContaining({ codec_name: 'mjpeg' }));
    expect(coverStream?.disposition?.attached_pic).toBe(1);

    vi.resetModules();
    const { extractAudioMetadata } = await import('../../../metadata/extractors/audio.extractor');
    const extracted = await extractAudioMetadata(filePath);
    expect(extracted.coverBytes?.length).toBeGreaterThan(0);

    await writer.write(filePath, { title: 'Retitled Covered Book' }, { dryRun: false, fieldMask: new Set(['title']) });

    const streamsAfterTextOnlyWrite = await probeStreams(filePath);
    const preservedCoverStream = streamsAfterTextOnlyWrite.find((stream) => stream.codec_type === 'video');
    expect(preservedCoverStream).toEqual(expect.objectContaining({ codec_name: 'mjpeg' }));
    expect(preservedCoverStream?.disposition?.attached_pic).toBe(1);
  });

  async function generateAudioFixture(filePath: string, codec = 'libmp3lame'): Promise<void> {
    const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.2', '-c:a', codec];
    if (codec === 'libmp3lame' || codec === 'aac') {
      args.push('-b:a', '64k');
    }
    args.push(filePath);
    await execFile(ffmpegPath, args);
  }

  async function generateCoverFixture(filePath: string): Promise<void> {
    await execFile(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', filePath]);
  }

  async function probeFormatTags(filePath: string): Promise<Record<string, string>> {
    const { stdout } = await execFile(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath]);
    const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
    return Object.fromEntries(Object.entries(parsed.format?.tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  }

  async function probeStreams(
    filePath: string,
  ): Promise<Array<{ codec_name?: string; codec_type?: string; disposition?: { attached_pic?: number } }>> {
    const { stdout } = await execFile(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath]);
    const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_name?: string; codec_type?: string; disposition?: { attached_pic?: number } }> };
    return parsed.streams ?? [];
  }
});
