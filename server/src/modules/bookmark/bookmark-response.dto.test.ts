import { BookmarkResponseDto } from './dto/bookmark-response.dto';

describe('BookmarkResponseDto', () => {
  it('maps nullable bookmark fields from repository rows', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const dto = BookmarkResponseDto.from({
      id: 11,
      userId: 22,
      bookId: 33,
      cfi: null,
      title: '00:01:23',
      positionSeconds: null,
      createdAt,
    } as never);

    expect(dto).toEqual({
      id: 11,
      bookId: 33,
      cfi: null,
      title: '00:01:23',
      positionSeconds: null,
      createdAt,
    });
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
