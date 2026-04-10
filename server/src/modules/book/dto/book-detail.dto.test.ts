import { AudioMetadataDto, BookDetailDto, BookFileDto } from './book-detail.dto';

describe('BookDetailDto', () => {
  it('supports nested assignment for files and audio metadata', () => {
    const file = Object.assign(new BookFileDto(), {
      id: 5,
      format: 'epub',
      role: 'primary',
      sizeBytes: 1024,
      absolutePath: '/books/example.epub',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      filename: 'example.epub',
      durationSeconds: null,
    });

    const audio = Object.assign(new AudioMetadataDto(), {
      narrators: [{ id: 2, name: 'Narrator Name', sortName: 'Narrator Name', displayOrder: 0 }],
      durationSeconds: 3600,
      abridged: false,
      chapters: [{ title: 'Chapter 1', startMs: 0 }],
    });

    const detail = Object.assign(new BookDetailDto(), {
      id: 10,
      title: 'Sample Book',
      files: [file],
      audioMetadata: audio,
      formatPriority: ['epub'],
      authors: [{ id: 1, name: 'Author', sortName: 'Author' }],
      genres: ['Sci-Fi'],
      tags: ['favorite'],
      lockedFields: [],
      collections: [{ id: 9, name: 'Shelf' }],
    });

    expect(detail.files[0]).toBeInstanceOf(BookFileDto);
    expect(detail.audioMetadata).toBeInstanceOf(AudioMetadataDto);
    expect(detail.files[0].absolutePath).toBe('/books/example.epub');
    expect(detail.audioMetadata?.chapters?.[0]?.title).toBe('Chapter 1');
  });
});
