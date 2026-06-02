import { AudioCoverEmbedder } from './audio-cover-embedder';
import { AudioFormatWriter, FlacAudioFormatWriter, M4aAudioFormatWriter, M4bAudioFormatWriter, Mp3AudioFormatWriter } from './audio-format-writer';

describe('AudioFormatWriter', () => {
  function makeWriter(format = 'm4b') {
    const embedder = { embedCover: vi.fn().mockResolvedValue(undefined) } as unknown as AudioCoverEmbedder;
    const writer = new AudioFormatWriter(format as never, embedder);
    return { writer, embedder };
  }

  it('returns skipped when cover bytes are absent', async () => {
    const { writer, embedder } = makeWriter();

    await expect(writer.write('/books/audio/book.m4b', { title: 'Book' }, { dryRun: false, fieldMask: new Set(['coverBytes']) })).resolves.toEqual(
      expect.objectContaining({ status: 'skipped', fieldsWritten: [], reason: 'no audio cover to write' }),
    );

    expect(embedder.embedCover).not.toHaveBeenCalled();
  });

  it('returns skipped for dry-run without mutating the file', async () => {
    const { writer, embedder } = makeWriter();

    const result = await writer.write(
      '/books/audio/book.m4b',
      { coverBytes: Buffer.from('cover') },
      { dryRun: true, fieldMask: new Set(['coverBytes']) },
    );

    expect(result).toEqual(expect.objectContaining({ status: 'skipped', fieldsWritten: ['coverBytes'], reason: 'dry-run' }));
    expect(embedder.embedCover).not.toHaveBeenCalled();
  });

  it('embeds the cover and returns success when cover writing is enabled', async () => {
    const { writer, embedder } = makeWriter('mp3');
    const coverBytes = Buffer.from('cover');

    const result = await writer.write('/books/audio/book.mp3', { coverBytes }, { dryRun: false, fieldMask: new Set(['coverBytes']) });

    expect(result).toEqual(expect.objectContaining({ status: 'success', fieldsWritten: ['coverBytes'] }));
    expect(embedder.embedCover).toHaveBeenCalledWith('/books/audio/book.mp3', coverBytes, 'mp3');
  });

  it('exposes one concrete writer per supported audio format', () => {
    const embedder = { embedCover: vi.fn() } as unknown as AudioCoverEmbedder;

    expect(new M4bAudioFormatWriter(embedder).format).toBe('m4b');
    expect(new M4aAudioFormatWriter(embedder).format).toBe('m4a');
    expect(new Mp3AudioFormatWriter(embedder).format).toBe('mp3');
    expect(new FlacAudioFormatWriter(embedder).format).toBe('flac');
  });
});
