import {
  AudioFormatWriter,
  FlacAudioFormatWriter,
  M4aAudioFormatWriter,
  M4bAudioFormatWriter,
  Mp3AudioFormatWriter,
  testing,
} from './audio-format-writer';
import { AudioMetadataEmbedder } from './audio-metadata-embedder';

describe('AudioFormatWriter', () => {
  function makeWriter(format = 'm4b') {
    const embedder = { embedMetadata: vi.fn().mockResolvedValue(undefined) } as unknown as AudioMetadataEmbedder;
    const writer = new AudioFormatWriter(format as never, embedder);
    return { writer, embedder };
  }

  it('returns skipped when no managed audio metadata is present', async () => {
    const { writer, embedder } = makeWriter();

    await expect(writer.write('/books/audio/book.m4b', {}, { dryRun: false, fieldMask: new Set(['coverBytes']) })).resolves.toEqual(
      expect.objectContaining({ status: 'skipped', fieldsWritten: [], reason: 'no audio metadata to write' }),
    );

    expect(embedder.embedMetadata).not.toHaveBeenCalled();
  });

  it('returns skipped for dry-run without mutating the file', async () => {
    const { writer, embedder } = makeWriter();

    const result = await writer.write(
      '/books/audio/book.m4b',
      { title: 'Book', coverBytes: Buffer.from('cover') },
      { dryRun: true, fieldMask: new Set(['title', 'coverBytes']) },
    );

    expect(result).toEqual(expect.objectContaining({ status: 'skipped', fieldsWritten: ['title', 'coverBytes'], reason: 'dry-run' }));
    expect(embedder.embedMetadata).not.toHaveBeenCalled();
  });

  it('embeds modern audiobook tags and returns success', async () => {
    const { writer, embedder } = makeWriter('mp3');
    const coverBytes = Buffer.from('cover');

    const result = await writer.write(
      '/books/audio/book.mp3',
      {
        title: 'Dune',
        subtitle: 'Book One',
        authors: [{ name: 'Frank Herbert', sortName: null }],
        narrators: ['Scott Brick'],
        publisher: 'Macmillan Audio',
        publishedYear: 2006,
        description: 'An epic sci-fi audiobook',
        genres: ['Science Fiction', 'Adventure'],
        language: 'eng',
        seriesName: 'Dune',
        seriesIndex: 1,
        audibleId: 'B000R34YKC',
        librofmId: '9781234567890',
        coverBytes,
      },
      {
        dryRun: false,
        fieldMask: new Set([
          'title',
          'subtitle',
          'authors',
          'narrators',
          'publisher',
          'publishedYear',
          'description',
          'genres',
          'language',
          'seriesName',
          'seriesIndex',
          'audibleId',
          'librofmId',
          'coverBytes',
        ]),
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        fieldsWritten: [
          'title',
          'subtitle',
          'authors',
          'narrators',
          'publishedYear',
          'publisher',
          'description',
          'genres',
          'language',
          'seriesName',
          'seriesIndex',
          'audibleId',
          'librofmId',
          'coverBytes',
        ],
      }),
    );
    expect(embedder.embedMetadata).toHaveBeenCalledWith(
      '/books/audio/book.mp3',
      'mp3',
      expect.objectContaining({
        coverBytes,
        metadata: expect.arrayContaining([
          { key: 'album', value: 'Dune' },
          { key: 'title', value: 'Dune' },
          { key: 'subtitle', value: 'Book One' },
          { key: 'album_artist', value: 'Frank Herbert' },
          { key: 'albumartist', value: 'Frank Herbert' },
          { key: 'artist', value: 'Frank Herbert' },
          { key: 'composer', value: 'Scott Brick' },
          { key: 'publisher', value: 'Macmillan Audio' },
          { key: 'date', value: '2006' },
          { key: 'year', value: '2006' },
          { key: 'description', value: 'An epic sci-fi audiobook' },
          { key: 'comment', value: 'An epic sci-fi audiobook' },
          { key: 'genre', value: 'Science Fiction; Adventure' },
          { key: 'language', value: 'eng' },
          { key: 'language', value: 'eng', specifier: 's:a:0' },
          { key: 'series', value: 'Dune' },
          { key: 'series-part', value: '1' },
          { key: 'asin', value: 'B000R34YKC' },
          { key: 'audible_asin', value: 'B000R34YKC' },
          { key: 'librofm_isbn', value: '9781234567890' },
        ]),
      }),
    );
  });

  it('writes multi-track title and track number from target context', async () => {
    const { writer, embedder } = makeWriter('m4a');

    const result = await writer.write(
      '/books/audio/01.mp3',
      { title: 'Book', authors: [{ name: 'Author', sortName: null }] },
      {
        dryRun: false,
        fieldMask: new Set(['title', 'authors']),
        isMultiTrackAudio: true,
        trackNumber: 2,
        trackTotal: 3,
        trackTitle: 'Disc 1 - Track 02',
      },
    );

    expect(result.fieldsWritten).toEqual(['title', 'authors', 'track']);
    expect(embedder.embedMetadata).toHaveBeenCalledWith(
      '/books/audio/01.mp3',
      'm4a',
      expect.objectContaining({
        coverBytes: null,
        metadata: expect.arrayContaining([
          { key: 'album', value: 'Book' },
          { key: 'title', value: 'Disc 1 - Track 02' },
          { key: 'track', value: '2/3' },
        ]),
      }),
    );
  });

  it('preserves existing cover when cover bytes are unavailable', async () => {
    const { writer, embedder } = makeWriter('flac');

    await writer.write('/books/audio/book.flac', { title: 'Book', coverBytes: null }, { dryRun: false, fieldMask: new Set(['title', 'coverBytes']) });

    expect(embedder.embedMetadata).toHaveBeenCalledWith('/books/audio/book.flac', 'flac', expect.objectContaining({ coverBytes: null }));
  });

  it('clears nullable fields by writing empty managed tag values', () => {
    const metadata = testing.buildAudioMetadataArgs(
      {
        title: null,
        subtitle: null,
        authors: [],
        narrators: [],
        publishedYear: null,
        publisher: null,
        description: null,
        genres: [],
        language: null,
        seriesName: null,
        seriesIndex: null,
        audibleId: null,
        librofmId: null,
      },
      {
        dryRun: false,
        fieldMask: new Set([
          'title',
          'subtitle',
          'authors',
          'narrators',
          'publishedYear',
          'publisher',
          'description',
          'genres',
          'language',
          'seriesName',
          'seriesIndex',
          'audibleId',
          'librofmId',
        ]),
      },
    );

    expect(metadata).toEqual(
      expect.arrayContaining([
        { key: 'album', value: '' },
        { key: 'subtitle', value: '' },
        { key: 'album_artist', value: '' },
        { key: 'composer', value: '' },
        { key: 'date', value: '' },
        { key: 'publisher', value: '' },
        { key: 'description', value: '' },
        { key: 'genre', value: '' },
        { key: 'language', value: '' },
        { key: 'series', value: '' },
        { key: 'series-part', value: '' },
        { key: 'asin', value: '' },
        { key: 'librofm_isbn', value: '' },
      ]),
    );
  });

  it.each(['m4b', 'm4a'])('writes artwork-safe MP4 series aliases for %s', (format) => {
    const metadata = testing.buildAudioMetadataArgs(
      { seriesName: 'The Murderbot Diaries', seriesIndex: 2.5 },
      { dryRun: false, fieldMask: new Set(['seriesName', 'seriesIndex']) },
      format,
    );

    expect(metadata).toEqual([
      { key: 'series', value: 'The Murderbot Diaries' },
      { key: 'show', value: 'The Murderbot Diaries' },
      { key: 'series-part', value: '2.5' },
      { key: 'episode_id', value: '2.5' },
    ]);
  });

  it.each(['m4b', 'm4a'])('clears custom and MP4-native series tags for %s', (format) => {
    const metadata = testing.buildAudioMetadataArgs(
      { seriesName: null, seriesIndex: null },
      { dryRun: false, fieldMask: new Set(['seriesName', 'seriesIndex']) },
      format,
    );

    expect(metadata).toEqual([
      { key: 'series', value: '' },
      { key: 'show', value: '' },
      { key: 'series-part', value: '' },
      { key: 'episode_id', value: '' },
    ]);
  });

  it.each(['mp3', 'flac'])('does not write MP4 series aliases for %s', (format) => {
    const metadata = testing.buildAudioMetadataArgs(
      { seriesName: 'The Murderbot Diaries', seriesIndex: 2 },
      { dryRun: false, fieldMask: new Set(['seriesName', 'seriesIndex']) },
      format,
    );

    expect(metadata).toEqual([
      { key: 'series', value: 'The Murderbot Diaries' },
      { key: 'series-part', value: '2' },
    ]);
  });

  it('exposes one concrete writer per supported audio format', () => {
    const embedder = { embedMetadata: vi.fn() } as unknown as AudioMetadataEmbedder;

    expect(new M4bAudioFormatWriter(embedder).format).toBe('m4b');
    expect(new M4aAudioFormatWriter(embedder).format).toBe('m4a');
    expect(new Mp3AudioFormatWriter(embedder).format).toBe('mp3');
    expect(new FlacAudioFormatWriter(embedder).format).toBe('flac');
  });
});
