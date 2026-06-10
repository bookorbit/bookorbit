import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { AnnotationsUploadDto } from './dto';
import type { KoreaderAnnotationRepository } from './koreader-annotation.repository';
import { KoreaderPluginAnnotationService } from './koreader-plugin-annotation.service';
import type { KoreaderRepository } from './koreader.repository';

const DEVICE_ID = 'abcdef12-3456-7890-abcd-ef1234567890';
const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

function makeUser(): RequestUser {
  return { id: 7, settings: {} } as unknown as RequestUser;
}

function makeDto(books: AnnotationsUploadDto['books']): AnnotationsUploadDto {
  return { deviceId: DEVICE_ID, deviceModel: 'Kobo Libra 2', pluginVersion: '0.1.0', books } as AnnotationsUploadDto;
}

function makeAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    datetime: '2026-06-01 21:14:03',
    drawer: 'lighten',
    posFormat: 'xpointer',
    pos0: '/body/DocFragment[8]/body/p[12]/text().0',
    pos1: '/body/DocFragment[8]/body/p[12]/text().57',
    text: 'highlighted text',
    ...overrides,
  } as AnnotationsUploadDto['books'][number]['annotations'][number];
}

describe('KoreaderPluginAnnotationService', () => {
  let koreaderRepo: { getAccessibleLibraryIds: ReturnType<typeof vi.fn>; resolveBookFilesByHashes: ReturnType<typeof vi.fn> };
  let annotationRepo: { upsertMany: ReturnType<typeof vi.fn>; listByBook: ReturnType<typeof vi.fn> };
  let service: KoreaderPluginAnnotationService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    koreaderRepo = {
      getAccessibleLibraryIds: vi.fn().mockResolvedValue([1]),
      resolveBookFilesByHashes: vi.fn().mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }]])),
    };
    annotationRepo = {
      upsertMany: vi.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
      listByBook: vi.fn().mockResolvedValue([]),
    };

    service = new KoreaderPluginAnnotationService(
      koreaderRepo as unknown as KoreaderRepository,
      annotationRepo as unknown as KoreaderAnnotationRepository,
    );
  });

  it('builds a stable annotation key from device datetime and pos0', () => {
    const first = service.buildAnnotationKey('2026-06-01 21:14:03', '/body/DocFragment[8]/body/p[12]/text().0');
    const second = service.buildAnnotationKey('2026-06-01 21:14:03', '/body/DocFragment[8]/body/p[12]/text().0');
    const different = service.buildAnnotationKey('2026-06-01 21:14:04', '/body/DocFragment[8]/body/p[12]/text().0');

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toBe(first);
    expect(different).not.toBe(first);
  });

  it('maps annotations to rows and dedupes identical keys within one batch', async () => {
    const dto = makeDto([
      {
        hash: HASH_A,
        annotations: [makeAnnotation({ note: 'first' }), makeAnnotation({ note: 'second' }), makeAnnotation({ datetime: '2026-06-02 10:00:00' })],
      },
    ]);

    const result = await service.uploadAnnotations(makeUser(), dto);

    const rows = annotationRepo.upsertMany.mock.calls[0]![0] as { annotationKey: string; note: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.note).toBe('second');
    expect(result.results[0]).toEqual({ hash: HASH_A, upserted: 2 });
  });

  it('carries datetimeUpdated into deviceUpdatedAt for edits', async () => {
    const dto = makeDto([{ hash: HASH_A, annotations: [makeAnnotation({ datetimeUpdated: '2026-06-03 09:30:00', note: 'edited note' })] }]);

    await service.uploadAnnotations(makeUser(), dto);

    const rows = annotationRepo.upsertMany.mock.calls[0]![0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      userId: 7,
      bookId: 20,
      bookFileId: 10,
      drawer: 'lighten',
      deviceCreatedAt: '2026-06-01 21:14:03',
      deviceUpdatedAt: '2026-06-03 09:30:00',
      note: 'edited note',
    });
  });

  it('reports unmatched hashes without upserting', async () => {
    const result = await service.uploadAnnotations(makeUser(), makeDto([{ hash: HASH_B, annotations: [makeAnnotation()] }]));

    expect(result.unmatched).toEqual([HASH_B]);
    expect(annotationRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('rejects requests with more than 50 annotations in total', async () => {
    const annotations = Array.from({ length: 51 }, (_, i) =>
      makeAnnotation({ datetime: `2026-06-01 21:14:${String(i % 60).padStart(2, '0')}`, pos0: `pos-${i}` }),
    );

    await expect(service.uploadAnnotations(makeUser(), makeDto([{ hash: HASH_A, annotations }]))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps stored rows to UI annotation items', async () => {
    annotationRepo.listByBook.mockResolvedValue([
      {
        id: 1,
        drawer: 'underscore',
        color: 'red',
        text: 'quote',
        note: null,
        chapter: 'Chapter 3',
        pageno: 42,
        posFormat: 'xpointer',
        deviceCreatedAt: '2026-06-01 21:14:03',
        deviceUpdatedAt: null,
      },
    ]);

    const items = await service.getBookAnnotations(7, 20);

    expect(annotationRepo.listByBook).toHaveBeenCalledWith(7, 20);
    expect(items).toEqual([
      {
        id: 1,
        drawer: 'underscore',
        color: 'red',
        text: 'quote',
        note: null,
        chapter: 'Chapter 3',
        pageno: 42,
        posFormat: 'xpointer',
        deviceCreatedAt: '2026-06-01 21:14:03',
        deviceUpdatedAt: null,
      },
    ]);
  });
});
