import { BookmarkResponseDto } from './dto/bookmark-response.dto';

describe('BookmarkResponseDto', () => {
  it('maps nullable bookmark fields from repository rows', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const updatedAt = new Date('2026-01-02T00:00:00Z');
    const dto = BookmarkResponseDto.from({
      id: 11,
      clientId: '0d2a4c8e-7b1f-4f55-9c3a-6e1b2d9f0a47',
      userId: 22,
      bookId: 33,
      cfi: null,
      title: '00:01:23',
      note: null,
      chapterId: null,
      positionSeconds: null,
      origin: 'web',
      devicePos: 'device-only',
      pageno: 4,
      createdAt,
      updatedAt,
      deletedAt: null,
    } as never);

    expect(dto).toEqual({
      id: 11,
      bookId: 33,
      cfi: null,
      title: '00:01:23',
      positionSeconds: null,
      createdAt,
      note: null,
      updatedAt,
      clientId: '0d2a4c8e-7b1f-4f55-9c3a-6e1b2d9f0a47',
      origin: 'web',
      chapterId: null,
    });
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('devicePos');
    expect(dto).not.toHaveProperty('deletedAt');
  });

  it('carries the note, origin and chapter id of an edited device bookmark', () => {
    const dto = BookmarkResponseDto.from({
      id: 9,
      clientId: '0d2a4c8e-7b1f-4f55-9c3a-6e1b2d9f0a47',
      userId: 7,
      bookId: 5,
      cfi: 'epubcfi(/6/2)',
      title: 'Renamed',
      note: 'Why I marked this',
      chapterId: 'chapter-3',
      positionSeconds: null,
      origin: 'koreader',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-03T00:00:00Z'),
    } as never);

    expect(dto).toMatchObject({ note: 'Why I marked this', origin: 'koreader', chapterId: 'chapter-3', title: 'Renamed' });
  });

  it('preserves provided CFI and position seconds values', () => {
    const dto = BookmarkResponseDto.from({
      id: 9,
      userId: 7,
      bookId: 5,
      cfi: 'epubcfi(/6/2)',
      title: 'Chapter 1',
      positionSeconds: 93.5,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    } as never);

    expect(dto.cfi).toBe('epubcfi(/6/2)');
    expect(dto.positionSeconds).toBe(93.5);
  });
});
