import { describe, expect, it, vi } from 'vitest';

import type { AnnotationPosition } from '../../../db/schema';
import type { AnnotationSyncService } from '../../annotation/annotation-sync.service';
import type { KepubContext, KoboSpanConverterService } from '../../position-converter/kobo-span-converter.service';
import type { PositionConverterService } from '../../position-converter/position-converter.service';
import type { KepubReaderFile } from './kobo-kepub-context.service';
import { KoboAnnotationMaterializerService } from './kobo-annotation-materializer.service';

const USER_ID = 1;
const BOOK_ID = 27;
const FILE: KepubReaderFile = { id: 31, bookId: BOOK_ID, absolutePath: '/path/to/book.epub', format: 'epub', fileHash: 'abc', sizeBytes: 1 };
const CTX: KepubContext = { kepubPath: '/path/to/book.kepub.epub', fileHash: 'abc', hyphenate: false, kepubifyVersion: 'v4' };
const SERVED_LOCATION = {
  span: {
    startPath: 'span#kobo\\.83\\.1',
    startChar: 0,
    endPath: 'span#kobo\\.84\\.1',
    endChar: 71,
    chapterFilename: 'OPS/c26.xhtml',
    chapterProgress: 0.45,
  },
};

function position(annotationId: number, format: string, overrides: Partial<AnnotationPosition> = {}): AnnotationPosition {
  return {
    id: annotationId * 10,
    annotationId,
    userId: USER_ID,
    bookFileId: FILE.id,
    format,
    pos0: format === 'cfi' ? `epubcfi(/6/66!/4/4,/242/1:0,/248/1:71)` : 'kobo.1.1:0',
    pos1: null,
    status: 'exact',
    converterVersion: 2,
    extras: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AnnotationPosition;
}

function stateRow(annotationId: number, externalKey: string, deletedAt: Date | null = null) {
  return {
    state: { annotationId, externalKey },
    annotation: { id: annotationId, text: 'Caleb was silent for a long time.', chapterTitle: 'Chapter 26', deletedAt },
  };
}

function makeService(rows: ReturnType<typeof stateRow>[], positions: AnnotationPosition[], conversion?: unknown) {
  const annotationSync = {
    listStatesBySourceForBook: vi.fn().mockResolvedValue(rows),
    findPositions: vi.fn().mockResolvedValue(positions),
    upsertGeneratedPosition: vi.fn().mockResolvedValue(undefined),
  };
  const koboSpanConverter = {
    version: 3,
    canonicalToKoboSpan: vi.fn().mockResolvedValue(
      conversion ?? {
        status: 'exact',
        pos0: 'kobo.83.1:0',
        pos1: 'kobo.84.1:71',
        chapterIndex: 32,
        renditionHash: 'rendition-a',
        location: SERVED_LOCATION,
      },
    ),
  };
  const service = new KoboAnnotationMaterializerService(
    annotationSync as unknown as AnnotationSyncService,
    koboSpanConverter as unknown as KoboSpanConverterService,
    {} as PositionConverterService,
  );
  return { service, annotationSync, koboSpanConverter };
}

describe('KoboAnnotationMaterializerService.recordServedSpans', () => {
  it('stores the served span of an uploaded highlight that has no Kobo position yet', async () => {
    const { service, annotationSync, koboSpanConverter } = makeService([stateRow(2035, 'uuid-2035')], [position(2035, 'cfi')]);

    const recorded = await service.recordServedSpans(USER_ID, BOOK_ID, FILE, CTX, ['uuid-2035']);

    expect(recorded).toBe(1);
    expect(koboSpanConverter.canonicalToKoboSpan).toHaveBeenCalledWith(
      expect.objectContaining({ bookFileId: FILE.id, cfi: 'epubcfi(/6/66!/4/4,/242/1:0,/248/1:71)', text: 'Caleb was silent for a long time.' }),
    );
    expect(annotationSync.upsertGeneratedPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationId: 2035,
        format: 'kobo_span',
        pos0: 'kobo.83.1:0',
        pos1: 'kobo.84.1:71',
        status: 'exact',
        extras: expect.objectContaining({
          koboLocation: SERVED_LOCATION,
          renditionHash: 'rendition-a',
          sourceCfi: 'epubcfi(/6/66!/4/4,/242/1:0,/248/1:71)',
        }),
      }),
    );
  });

  it('leaves highlights that already hold a Kobo position, were not uploaded, or are trashed', async () => {
    const { service, annotationSync, koboSpanConverter } = makeService(
      [stateRow(1, 'made-on-kobo'), stateRow(2, 'not-in-upload'), stateRow(3, 'trashed', new Date())],
      [position(1, 'cfi'), position(1, 'kobo_span'), position(2, 'cfi'), position(3, 'cfi')],
    );

    expect(await service.recordServedSpans(USER_ID, BOOK_ID, FILE, CTX, ['made-on-kobo', 'trashed'])).toBe(0);
    expect(koboSpanConverter.canonicalToKoboSpan).not.toHaveBeenCalled();
    expect(annotationSync.upsertGeneratedPosition).not.toHaveBeenCalled();
  });

  it('stores nothing when there is no usable cfi or the span cannot be placed', async () => {
    const failedCfi = makeService([stateRow(4, 'k4')], [position(4, 'cfi', { status: 'failed' })]);
    expect(await failedCfi.service.recordServedSpans(USER_ID, BOOK_ID, FILE, CTX, ['k4'])).toBe(0);
    expect(failedCfi.koboSpanConverter.canonicalToKoboSpan).not.toHaveBeenCalled();

    const unplaced = makeService([stateRow(5, 'k5')], [position(5, 'cfi')], {
      status: 'failed',
      reason: 'span_not_found',
      renditionHash: 'rendition-a',
    });
    expect(await unplaced.service.recordServedSpans(USER_ID, BOOK_ID, FILE, CTX, ['k5'])).toBe(0);
    expect(unplaced.annotationSync.upsertGeneratedPosition).not.toHaveBeenCalled();
  });

  it('does nothing for an upload with no operations', async () => {
    const { service, annotationSync } = makeService([], []);

    expect(await service.recordServedSpans(USER_ID, BOOK_ID, FILE, CTX, [])).toBe(0);
    expect(annotationSync.listStatesBySourceForBook).not.toHaveBeenCalled();
  });
});
