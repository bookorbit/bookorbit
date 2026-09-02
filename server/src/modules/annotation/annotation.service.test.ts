import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type { RequestUser } from '../../common/types/request-user';
import { AchievementEventsService } from '../achievement/achievement-events.service';
import { BookService } from '../book/book.service';
import { DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_STYLE } from './annotation.constants';
import { AnnotationConversionService } from './annotation-conversion.service';
import { AnnotationRepository } from './annotation.repository';
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

async function makeService() {
  const annotationRepo = {
    findByBookId: vi.fn(),
    findPaginated: vi.fn(),
    getStats: vi.fn(),
    getDistinctChapters: vi.fn(),
    create: vi.fn(),
    createPdf: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
  const bookService = {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    verifyFileAccess: vi.fn().mockResolvedValue({ id: 50, bookId: 5, format: 'pdf' }),
  };
  const achievementEvents = {
    emit: vi.fn(),
  };
  const conversionService = {
    ensureCfiPositionsForBook: vi.fn().mockResolvedValue(0),
  };
  const module = await Test.createTestingModule({
    providers: [
      AnnotationService,
      { provide: AnnotationRepository, useValue: annotationRepo },
      { provide: BookService, useValue: bookService },
      { provide: AchievementEventsService, useValue: achievementEvents },
      { provide: AnnotationConversionService, useValue: conversionService },
    ],
  }).compile();
  const service = module.get(AnnotationService);
  return {
    service,
    annotationRepo,
    bookService,
    conversionService,
    achievementEvents,
  };
}

describe('AnnotationService', () => {
  describe('getAnnotations', () => {
    it('returns mapped response DTOs for the user and book', async () => {
      const { service, annotationRepo } = await makeService();
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
      const { service, annotationRepo, bookService } = await makeService();
      annotationRepo.findByBookId.mockResolvedValue([]);

      await service.getAnnotations(5, makeUser());

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException from book access check', async () => {
      const { service, bookService } = await makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.getAnnotations(5, makeUser())).rejects.toThrow(ForbiddenException);
    });

    it('propagates NotFoundException when book does not exist', async () => {
      const { service, bookService } = await makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.getAnnotations(5, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('returns empty array when no annotations exist', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findByBookId.mockResolvedValue([]);

      const result = await service.getAnnotations(5, makeUser());

      expect(result).toEqual([]);
    });

    it('strips userId and updatedAt from response', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findByBookId.mockResolvedValue([makeAnnotationRow()]);

      const result = await service.getAnnotations(5, makeUser());

      expect(result[0]).not.toHaveProperty('userId');
      expect(result[0]).not.toHaveProperty('updatedAt');
    });
  });

  describe('createAnnotation', () => {
    it('creates annotation with provided values', async () => {
      const { service, annotationRepo } = await makeService();
      const row = makeAnnotationRow({
        color: '#FACC15',
        style: 'underline',
        note: 'my note',
      });
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
      const { service, annotationRepo } = await makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      const dto: CreateAnnotationDto = { cfi: 'epubcfi(/6/4)', text: 'text' };
      await service.createAnnotation(5, makeUser(), dto);

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ color: DEFAULT_ANNOTATION_COLOR }));
    });

    it('applies default style when style is not provided', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      const dto: CreateAnnotationDto = { cfi: 'epubcfi(/6/4)', text: 'text' };
      await service.createAnnotation(5, makeUser(), dto);

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ style: DEFAULT_ANNOTATION_STYLE }));
    });

    it('stores null note when not provided', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      await service.createAnnotation(5, makeUser(), {
        cfi: 'epubcfi(/6/4)',
        text: 'text',
      });

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    });

    it('stores null note when explicitly passed as null', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      await service.createAnnotation(5, makeUser(), {
        cfi: 'epubcfi(/6/4)',
        text: 'text',
        note: null,
      });

      expect(annotationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    });

    it('verifies book access before creating', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      annotationRepo.create.mockResolvedValue(makeAnnotationRow());

      await service.createAnnotation(5, makeUser(), {
        cfi: 'epubcfi(/6/4)',
        text: 'text',
      });

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException when user cannot access book', async () => {
      const { service, bookService } = await makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(
        service.createAnnotation(5, makeUser(), {
          cfi: 'epubcfi(/6/4)',
          text: 'text',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a pdf annotation via createPdf with serialized geometry and derived pageno', async () => {
      const { service, annotationRepo } = await makeService();
      const row = makeAnnotationRow({
        cfi: null,
        cfiStatus: null,
        jumpFileId: 50,
        pageno: 4,
        pdfPos0: JSON.stringify({
          page: 3,
          rect: { x: 1, y: 2, width: 3, height: 4 },
          rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        }),
        pdfStatus: 'exact',
      });
      annotationRepo.createPdf.mockResolvedValue(row);

      const dto: CreateAnnotationDto = {
        pdf: {
          page: 3,
          rect: { x: 1, y: 2, width: 3, height: 4 },
          rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        },
        bookFileId: 50,
        text: 'selected text',
        color: '#38BDF8',
        style: 'highlight',
      };

      const result = await service.createAnnotation(5, makeUser(), dto);

      expect(annotationRepo.create).not.toHaveBeenCalled();
      expect(annotationRepo.createPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          bookId: 5,
          bookFileId: 50,
          text: 'selected text',
          color: '#38BDF8',
        }),
        {
          page: 3,
          pos0: JSON.stringify({
            page: 3,
            rect: { x: 1, y: 2, width: 3, height: 4 },
            rects: [{ x: 1, y: 2, width: 3, height: 4 }],
          }),
        },
      );
      expect(result.cfi).toBeNull();
      expect(result.pageno).toBe(4);
      expect(result.pdf).toEqual({
        page: 3,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        rects: [{ x: 1, y: 2, width: 3, height: 4 }],
      });
    });

    it('emits the annotation-created achievement event for pdf annotations', async () => {
      const { service, annotationRepo, achievementEvents } = await makeService();
      annotationRepo.createPdf.mockResolvedValue(makeAnnotationRow({ id: 77, cfi: null }));

      await service.createAnnotation(5, makeUser(), {
        pdf: {
          page: 0,
          rect: { x: 0, y: 0, width: 1, height: 1 },
          rects: [{ x: 0, y: 0, width: 1, height: 1 }],
        },
        bookFileId: 50,
        text: 'text',
      });

      expect(achievementEvents.emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 1, bookId: 5, annotationId: 77 }));
    });

    it('rejects a pdf annotation without a book file', async () => {
      const { service, annotationRepo } = await makeService();

      await expect(
        service.createAnnotation(5, makeUser(), {
          pdf: {
            page: 0,
            rect: { x: 0, y: 0, width: 1, height: 1 },
            rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
          text: 'text',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(annotationRepo.createPdf).not.toHaveBeenCalled();
    });

    it('rejects a pdf annotation whose file belongs to another book', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      bookService.verifyFileAccess.mockResolvedValue({
        id: 50,
        bookId: 6,
        format: 'pdf',
      });

      await expect(
        service.createAnnotation(5, makeUser(), {
          pdf: {
            page: 0,
            rect: { x: 0, y: 0, width: 1, height: 1 },
            rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
          bookFileId: 50,
          text: 'text',
        }),
      ).rejects.toThrow('does not belong');
      expect(annotationRepo.createPdf).not.toHaveBeenCalled();
    });

    it('rejects a pdf annotation anchored to a non-pdf file', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      bookService.verifyFileAccess.mockResolvedValue({
        id: 50,
        bookId: 5,
        format: 'epub',
      });

      await expect(
        service.createAnnotation(5, makeUser(), {
          pdf: {
            page: 0,
            rect: { x: 0, y: 0, width: 1, height: 1 },
            rects: [{ x: 0, y: 0, width: 1, height: 1 }],
          },
          bookFileId: 50,
          text: 'text',
        }),
      ).rejects.toThrow('require a PDF');
      expect(annotationRepo.createPdf).not.toHaveBeenCalled();
    });
  });

  describe('updateAnnotation', () => {
    it('updates annotation and returns mapped response DTO', async () => {
      const { service, annotationRepo } = await makeService();
      const updated = makeAnnotationRow({ note: 'updated note' });
      annotationRepo.update.mockResolvedValue(updated);

      const dto: UpdateAnnotationDto = { note: 'updated note' };
      const result = await service.updateAnnotation(5, 10, makeUser(), dto);

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, {
        note: 'updated note',
      });
      expect(result).toBeInstanceOf(AnnotationResponseDto);
      expect(result.note).toBe('updated note');
    });

    it('clears note when null is passed', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow({ note: null }));

      await service.updateAnnotation(5, 10, makeUser(), { note: null });

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, {
        note: null,
      });
    });

    it('does not include note in patch when note is undefined', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow({ color: '#4ADE80' }));

      await service.updateAnnotation(5, 10, makeUser(), { color: '#4ADE80' });

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, {
        color: '#4ADE80',
      });
      const callArg = annotationRepo.update.mock.calls[0][3];
      expect(callArg).not.toHaveProperty('note');
    });

    it('throws NotFoundException when annotation is not found', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.update.mockResolvedValue(null);

      await expect(service.updateAnnotation(5, 99, makeUser(), { note: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message includes bookId and annotationId', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.update.mockResolvedValue(null);

      await expect(service.updateAnnotation(5, 99, makeUser(), {})).rejects.toThrow('Annotation 99 not found for book 5');
    });

    it('verifies book access before updating', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow());

      await service.updateAnnotation(5, 10, makeUser(), {});

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException before touching the annotation', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.updateAnnotation(5, 10, makeUser(), {})).rejects.toThrow(ForbiddenException);
      expect(annotationRepo.update).not.toHaveBeenCalled();
    });

    it('updates color and style independently', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.update.mockResolvedValue(makeAnnotationRow({ color: '#38BDF8', style: 'underline' }));

      await service.updateAnnotation(5, 10, makeUser(), {
        color: '#38BDF8',
        style: 'underline',
      });

      expect(annotationRepo.update).toHaveBeenCalledWith(5, 10, 1, {
        color: '#38BDF8',
        style: 'underline',
      });
    });
  });

  describe('deleteAnnotation', () => {
    it('deletes annotation successfully', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.softDelete.mockResolvedValue(true);

      await expect(service.deleteAnnotation(5, 10, makeUser())).resolves.toBeUndefined();
      expect(annotationRepo.softDelete).toHaveBeenCalledWith(5, 10, 1);
    });

    it('throws NotFoundException when annotation is not found', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.softDelete.mockResolvedValue(false);

      await expect(service.deleteAnnotation(5, 99, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message includes bookId and annotationId', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.softDelete.mockResolvedValue(false);

      await expect(service.deleteAnnotation(5, 99, makeUser())).rejects.toThrow('Annotation 99 not found for book 5');
    });

    it('verifies book access before deleting', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      annotationRepo.softDelete.mockResolvedValue(true);

      await service.deleteAnnotation(5, 10, makeUser());

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException before touching the annotation', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.deleteAnnotation(5, 10, makeUser())).rejects.toThrow(ForbiddenException);
      expect(annotationRepo.softDelete).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when book does not exist', async () => {
      const { service, bookService } = await makeService();
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

    it('parses pdf geometry and derives positionStatus for a pdf row', () => {
      const geometry = {
        page: 2,
        rect: { x: 10, y: 20, width: 30, height: 8 },
        rects: [{ x: 10, y: 20, width: 30, height: 8 }],
      };
      const row = makeAnnotationRow({
        cfi: null,
        cfiStatus: null,
        pageno: 3,
        pdfPos0: JSON.stringify(geometry),
        pdfStatus: 'exact',
      });

      const dto = AnnotationResponseDto.from(row as never);

      expect(dto.cfi).toBeNull();
      expect(dto.pdf).toEqual(geometry);
      expect(dto.positionStatus).toBe('exact');
    });

    it('returns null pdf and null positionStatus when no position exists', () => {
      const row = makeAnnotationRow({
        cfi: null,
        cfiStatus: null,
        pdfPos0: null,
        pdfStatus: null,
      });
      const dto = AnnotationResponseDto.from(row as never);
      expect(dto.pdf).toBeNull();
      expect(dto.positionStatus).toBeNull();
    });

    it('ignores malformed pdf geometry json', () => {
      const row = makeAnnotationRow({
        cfi: null,
        cfiStatus: null,
        pdfPos0: 'not-json',
        pdfStatus: 'exact',
      });
      const dto = AnnotationResponseDto.from(row as never);
      expect(dto.pdf).toBeNull();
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
        chapterBreakdown: [],
        activity: [],
        ...overrides,
      };
    }

    it('returns paginated response with items, total, and stats', async () => {
      const { service, annotationRepo } = await makeService();
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
      const { service, annotationRepo, bookService } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1 });

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, expect.objectContaining({ id: 1 }));
    });

    it('propagates ForbiddenException from book access check', async () => {
      const { service, bookService } = await makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.getAnnotationsPaginated(5, makeUser(), { page: 1 })).rejects.toThrow(ForbiddenException);
    });

    it('defaults to page 1 and pageSize 25 when not specified', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      const result = await service.getAnnotationsPaginated(5, makeUser(), {});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });

    it('parses color filter from comma-separated string', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
        colors: '#FACC15,#4ADE80',
      });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.colors).toEqual(['#FACC15', '#4ADE80']);
    });

    it('passes search filter to repository', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
        search: 'freedom',
      });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.search).toBe('freedom');
    });

    it('passes date filters to repository', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
        dateFrom: '2026-01-01',
        dateTo: '2026-06-01',
      });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.dateFrom).toBeInstanceOf(Date);
      expect(filtersArg.dateTo).toBeInstanceOf(Date);
    });

    it('defaults sort to position asc', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), { page: 1 });

      const sortArg = annotationRepo.findPaginated.mock.calls[0][3];
      expect(sortArg).toEqual({ by: 'position', dir: 'asc' });
    });

    it('respects custom sort params', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
        sortBy: 'createdAt',
        sortDir: 'desc',
      });

      const sortArg = annotationRepo.findPaginated.mock.calls[0][3];
      expect(sortArg).toEqual({ by: 'createdAt', dir: 'desc' });
    });

    it('serializes createdAt as ISO string in items', async () => {
      const { service, annotationRepo } = await makeService();
      const row = makeAnnotationRow({
        createdAt: new Date('2026-03-15T12:00:00Z'),
      });
      annotationRepo.findPaginated.mockResolvedValue({
        items: [row],
        total: 1,
      });
      annotationRepo.getStats.mockResolvedValue(makeStatsResult());
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      const result = await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
      });

      expect(result.items[0].createdAt).toBe('2026-03-15T12:00:00.000Z');
    });

    it('includes pdf geometry in paginated items', async () => {
      const { service, annotationRepo } = await makeService();
      const pdf = {
        page: 2,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        rects: [{ x: 1, y: 2, width: 3, height: 4 }],
      };
      annotationRepo.findPaginated.mockResolvedValue({
        items: [makeAnnotationRow({ cfi: null, pdfPos0: JSON.stringify(pdf) })],
        total: 1,
      });
      annotationRepo.getStats.mockResolvedValue(makeStatsResult());
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      const result = await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
      });

      expect(result.items[0].pdf).toEqual(pdf);
    });

    it('verifies and forwards a file-scoped filter', async () => {
      const { service, annotationRepo, bookService } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(makeStatsResult());
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
        bookFileId: 50,
      });

      expect(bookService.verifyFileAccess).toHaveBeenCalledWith(50, expect.objectContaining({ id: 1 }));
      expect(annotationRepo.findPaginated.mock.calls[0][2]).toMatchObject({
        bookFileId: 50,
      });
    });

    it('returns empty items and zero total when no annotations match', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      const result = await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.stats.totalHighlights).toBe(0);
    });

    it('ignores empty color string', async () => {
      const { service, annotationRepo } = await makeService();
      annotationRepo.findPaginated.mockResolvedValue({ items: [], total: 0 });
      annotationRepo.getStats.mockResolvedValue(
        makeStatsResult({
          totalHighlights: 0,
          colorBreakdown: [],
          chaptersWithHighlights: 0,
          highlightsWithNotes: 0,
        }),
      );
      annotationRepo.getDistinctChapters.mockResolvedValue([]);

      await service.getAnnotationsPaginated(5, makeUser(), {
        page: 1,
        colors: '',
      });

      const filtersArg = annotationRepo.findPaginated.mock.calls[0][2];
      expect(filtersArg.colors).toBeUndefined();
    });
  });
});
