import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_STYLE } from './annotation.constants';
import { AnnotationService } from './annotation.service';
import { AnnotationResponseDto } from './dto/annotation-response.dto';
import type { CreateAnnotationDto } from './dto/create-annotation.dto';
import type { UpdateAnnotationDto } from './dto/update-annotation.dto';
import type { AnnotationQueryDto } from './dto/annotation-query.dto';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeAnnotationRow(overrides?: Record<string, unknown>) {
  return {
    id: 10,
    userId: 1,
    bookId: 5,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    cfiStatus: 'exact',
    cfiExtras: null,
    jumpFileId: 50,
    pageno: null,
    text: 'selected text',
    color: 'yellow',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    version: 1,
    deletedAt: null,
    deviceCreatedAt: null,
    deviceUpdatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  const annotationRepo = {
    findByBookId: vi.fn(),
    findPaginated: vi.fn(),
    getStats: vi.fn(),
    getDistinctChapters: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
  const bookService = {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
  };
  const achievementEvents = {
    emit: vi.fn(),
  };
  const conversionService = { ensureCfiPositionsForBook: vi.fn().mockResolvedValue(0) };
  const service = new AnnotationService(annotationRepo as never, bookService as never, achievementEvents as never, conversionService as never);
  return { service, annotationRepo, bookService, conversionService };
}

describe('AnnotationService', () => {
  describe('getAnnotations', () => {
    it('returns mapped response DTOs for the user and book', async () => {
      const { service, annotationRepo } = makeService();
      const user = makeUser();
      const row = makeAnnotationRow();
      annotationRepo.findByBookId.mockResolvedValue([row]);

      const result = await service.getAnnotations(5, user);

      expect(annotationRepo.findByBookId).toHaveBeenCalledWith(5, 1);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(AnnotationResponseDto);
      expect(result[0].id).toBe(10);
      expect(result[0].bookId).toBe(5);
    });

    it('verifies book access before querying', async () => {
      const { service, annotationRepo, bookService } = makeService();
      annotationRepo.findByBookId.mockResolvedValue([]);

      await service.getAnnotations(5, makeUser());

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException from book access check', async () => {
      const { service, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.getAnnotations(5, makeUser())).rejects.toThrow(ForbiddenException);
    });

    it('propagates NotFoundException when book does not exist', async () => {
      const { service, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.getAnnotations(5, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('returns empty array when no annotations exist', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findByBookId.mockResolvedValue([]);

      const result = await service.getAnnotations(5, makeUser());

      expect(result).toEqual([]);
    });

    it('strips userId and updatedAt from response', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findByBookId.mockResolvedValue([makeAnnotationRow()]);

      const result = await service.getAnnotations(5, makeUser());

      expect(result[0]).not.toHaveProperty('userId');
      expect(result[0]).not.toHaveProperty('updatedAt');
    });
  });

  describe('createAnnotation', () => {
    it('creates annotation with provided values', async () => {
      const { service, annotationRepo } = makeService();
      const row = makeAnnotationRow({ color: '#FACC15', style: 'underline', note: 'my note' });
      annotationRepo.create.mockResolvedValue(row);

      const dto: CreateAnnotationDto = {
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        text: 'selected text',
        color: '#FACC15',
        style: 'underline',
        note: 'my note',
        chapterTitle: 'Chapter 1',
      };

      const result = await service.createAnnotation(5, makeUser(), dto);

      expect(annotationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          bookId: 5,
          cfi: 'epubcfi(/6/4!/4/2/1:0)',
          text: 'selected text',
          color: '#FACC15',
          style: 'underline',
          note: 'my note',
          chapterTitle: 'Chapter 1',
        }),
      );
      expect(result).toBeInstanceOf(AnnotationResponseDto);
    });

    it('applies default color when color is not provided', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      const dto: CreateAnnotationDto = { cfi: 'epubcfi(/6/4)', text: 'text' };
      await service.createAnnotation(5, makeUser(), dto);

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ color: DEFAULT_ANNOTATION_COLOR }));
    });

    it('applies default style when style is not provided', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      const dto: CreateAnnotationDto = { cfi: 'epubcfi(/6/4)', text: 'text' };
      await service.createAnnotation(5, makeUser(), dto);

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ style: DEFAULT_ANNOTATION_STYLE }));
    });

    it('stores null note when not provided', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      await service.createAnnotation(5, makeUser(), { cfi: 'epubcfi(/6/4)', text: 'text' });

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    });

    it('stores null note when explicitly passed as null', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      await service.createAnnotation(5, makeUser(), { cfi: 'epubcfi(/6/4)', text: 'text', note: null });

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    });

    it('verifies book access before creating', async () => {
      const { service, annotationRepo, bookService } = makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      await service.createAnnotation(5, makeUser(), { cfi: 'epubcfi(/6/4)', text: 'text' });

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException when user cannot access book', async () => {
      const { service, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.createAnnotation(5, makeUser(), { cfi: 'epubcfi(/6/4)', text: 'text' })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateAnnotation', () => {
    it('updates annotation and returns mapped response DTO', async () => {
      const { service, annotationRepo } = makeService();
      const updated = makeAnnotationRow({ note: 'updated note' });
      annotationRepo.update.mockResolvedValue(updated);

      const dto: UpdateAnnotationDto = { note: 'updated note' };
      const result = await service.updateAnnotation(5, 10, makeUser(), dto);

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, { note: 'updated note' });
      expect(result).toBeInstanceOf(AnnotationResponseDto);
      expect(result.note).toBe('updated note');
    });

    it('clears note when null is passed', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow({ note: null }));

      await service.updateAnnotation(5, 10, makeUser(), { note: null });

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, { note: null });
    });

    it('does not include note in patch when note is undefined', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow({ color: '#4ADE80' }));

      await service.updateAnnotation(5, 10, makeUser(), { color: '#4ADE80' });

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, { color: '#4ADE80' });
      const callArg = annotationRepo.update.mock.calls[0][3];
      expect(callArg).not.toHaveProperty('note');
    });

    it('throws NotFoundException when annotation is not found', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.update.mockResolvedValue(null);

      await expect(service.updateAnnotation(5, 99, makeUser(), { note: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message includes bookId and annotationId', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.update.mockResolvedValue(null);

      await expect(service.updateAnnotation(5, 99, makeUser(), {})).rejects.toThrow('Annotation 99 not found for book 5');
    });

    it('verifies book access before updating', async () => {
      const { service, annotationRepo, bookService } = makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow());

      await service.updateAnnotation(5, 10, makeUser(), {});

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException before touching the annotation', async () => {
      const { service, annotationRepo, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.updateAnnotation(5, 10, makeUser(), {})).rejects.toThrow(ForbiddenException);
      expect(annotationRepo.update).not.toHaveBeenCalled();
    });

    it('updates color and style independently', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow({ color: '#38BDF8', style: 'underline' }));

      await service.updateAnnotation(5, 10, makeUser(), { color: '#38BDF8', style: 'underline' });

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, { color: '#38BDF8', style: 'underline' });
    });
  });

  describe('deleteAnnotation', () => {
    it('deletes annotation successfully', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.softDelete.mockResolvedValue(true);

      await expect(service.deleteAnnotation(5, 10, makeUser())).resolves.toBeUndefined();
      expect(annotationRepo.softDelete).toHaveBeenCalledWith(5, 10, 1);
    });

    it('throws NotFoundException when annotation is not found', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.softDelete.mockResolvedValue(false);

      await expect(service.deleteAnnotation(5, 99, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message includes bookId and annotationId', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.softDelete.mockResolvedValue(false);

      await expect(service.deleteAnnotation(5, 99, makeUser())).rejects.toThrow('Annotation 99 not found for book 5');
    });

    it('verifies book access before deleting', async () => {
      const { service, annotationRepo, bookService } = makeService();
      annotationRepo.softDelete.mockResolvedValue(true);

      await service.deleteAnnotation(5, 10, makeUser());

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException before touching the annotation', async () => {
      const { service, annotationRepo, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.deleteAnnotation(5, 10, makeUser())).rejects.toThrow(ForbiddenException);
      expect(annotationRepo.softDelete).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when book does not exist', async () => {
      const { service, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.deleteAnnotation(5, 10, makeUser())).rejects.toThrow(NotFoundException);
    });
  });

  describe('AnnotationResponseDto mapping', () => {
    it('maps all expected fields from a DB row', () => {
      const row = makeAnnotationRow({
        id: 42,
        bookId: 7,
        cfi: 'epubcfi(/6/2!/4)',
        text: 'some text',
        color: '#4ADE80',
        style: 'underline',
        note: 'a note',
        chapterTitle: 'Intro',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      });

      const dto = AnnotationResponseDto.from(row as never);

      expect(dto.id).toBe(42);
      expect(dto.bookId).toBe(7);
      expect(dto.cfi).toBe('epubcfi(/6/2!/4)');
      expect(dto.text).toBe('some text');
      expect(dto.color).toBe('#4ADE80');
      expect(dto.style).toBe('underline');
      expect(dto.note).toBe('a note');
      expect(dto.chapterTitle).toBe('Intro');
      expect(dto.createdAt).toEqual(new Date('2026-03-01T00:00:00Z'));
    });

    it('coerces undefined note to null', () => {
      const row = makeAnnotationRow({ note: undefined });
      const dto = AnnotationResponseDto.from(row as never);
      expect(dto.note).toBeNull();
    });

    it('coerces undefined chapterTitle to null', () => {
      const row = makeAnnotationRow({ chapterTitle: undefined });
      const dto = AnnotationResponseDto.from(row as never);
      expect(dto.chapterTitle).toBeNull();
    });
  });

  describe('getAnnotationsPaginated', () => {
    function makeStatsResult(overrides?: Record<string, unknown>) {
      return {
        totalHighlights: 3,
        colorBreakdown: [
          { color: 'yellow', count: 2 },
          { color: '#4ADE80', count: 1 },
        ],
        originBreakdown: [{ origin: 'web', count: 3 }],
        chaptersWithHighlights: 2,
        highlightsWithNotes: 1,
        ...overrides,
      };
    }

    it('returns paginated response with items, total, and stats', async () => {
      const { service, annotationRepo } = makeService();
      const rows = [makeAnnotationRow(), makeAnnotationRow({ id: 11 })];
      annotationRepo.findPaginated.mockResolvedValue({ items: rows, total: 2 });
      annotationRepo.getStats.mockResolvedValue(makeStatsResult());
      annotationRepo.getDistinctChapters.mockResolvedValue(['Chapter 1', 'Chapter 2']);

      const query: AnnotationQueryDto = { page: 1, pageSize: 25 };
      const result = await service.getAnnotationsPaginated(5, makeUser(), query);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(result.stats.totalHighlights).toBe(3);
      expect(result.stats.chapters).toEqual(['Chapter 1', 'Chapter 2']);
    });

    it('verifies book access before querying', async () => {
      const { service, annotationRepo, bookService } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1 });

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException from book access check', async () => {
      const { service, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.getAnnotationsPaginated(5, makeUser(), { page: 1 })).rejects.toThrow(ForbiddenException);
    });

    it('defaults to page 1 and pageSize 25 when not specified', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      const result = await service.getAnnotationsPaginated(5, makeUser(), {});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });

    it('parses color filter from comma-separated string', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1, colors: '#FACC15,#4ADE80' });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.colors).toEqual(['#FACC15', '#4ADE80']);
    });

    it('passes search filter to repository', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1, search: 'freedom' });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.search).toBe('freedom');
    });

    it('passes date filters to repository', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1, dateFrom: '2026-01-01', dateTo: '2026-06-01' });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.dateFrom).toBeInstanceOf(Date);
      expect(filtersArg.dateTo).toBeInstanceOf(Date);
    });

    it('defaults sort to position asc', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1 });

      const sortArg = annotationRepo.findPaginated.mock.calls[0][3];
      expect(sortArg).toEqual({ by: 'position', dir: 'asc' });
    });

    it('respects custom sort params', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1, sortBy: 'createdAt', sortDir: 'desc' });

      const sortArg = annotationRepo.findPaginated.mock.calls[0][3];
      expect(sortArg).toEqual({ by: 'createdAt', dir: 'desc' });
    });

    it('serializes createdAt as ISO string in items', async () => {
      const { service, annotationRepo } = makeService();
      const row = makeAnnotationRow({ createdAt: new Date('2026-03-15T12:00:00Z') });
      annotationRepo.findPaginated.mockResolvedValue({ items: [row], total: 1 });
      annotationRepo.getStats.mockResolvedValue(makeStatsResult());
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      const result = await service.getAnnotationsPaginated(5, makeUser(), { page: 1 });

      expect(result.items[0].createdAt).toBe('2026-03-15T12:00:00.000Z');
    });

    it('returns empty items and zero total when no annotations match', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      const result = await service.getAnnotationsPaginated(5, makeUser(), { page: 1 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.stats.totalHighlights).toBe(0);
    });

    it('ignores empty color string', async () => {
      const { service, annotationRepo } = makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({ totalHighlights: 0, colorBreakdown: [], chaptersWithHighlights: 0, highlightsWithNotes: 0 }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1, colors: '' });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.colors).toBeUndefined();
    });
  });
});
