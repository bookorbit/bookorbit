import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { AnnotationSyncService, IncomingDeviceAnnotation } from '../annotation/annotation-sync.service';
import type { AnnotationsUploadDto } from './dto';
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
  let annotationSync: {
    ingestDeviceAnnotations: ReturnType<typeof vi.fn>;
  };
  let service: KoreaderPluginAnnotationService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    koreaderRepo = {
      getAccessibleLibraryIds: vi.fn().mockResolvedValue([1]),
      resolveBookFilesByHashes: vi.fn().mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }]])),
    };
    annotationSync = {
      ingestDeviceAnnotations: vi
        .fn()
        .mockImplementation((params: { annotations: unknown[] }) =>
          Promise.resolve({ created: params.annotations.length, updated: 0, moved: 0, unchanged: 0, skippedDeleted: 0 }),
        ),
    };

    service = new KoreaderPluginAnnotationService(koreaderRepo as unknown as KoreaderRepository, annotationSync as unknown as AnnotationSyncService);
  });

  it('routes matched books through the sync ingest with mapped fields', async () => {
    const dto = makeDto([
      { hash: HASH_A, annotations: [makeAnnotation({ datetimeUpdated: '2026-06-03 09:30:00', note: 'edited note', color: 'red' })] },
    ]);

    const result = await service.uploadAnnotations(makeUser(), dto);

    expect(annotationSync.ingestDeviceAnnotations).toHaveBeenCalledTimes(1);
    const params = annotationSync.ingestDeviceAnnotations.mock.calls[0]![0] as {
      userId: number;
      source: string;
      deviceId: string;
      bookId: number;
      bookFileId: number;
      annotations: IncomingDeviceAnnotation[];
    };
    expect(params).toMatchObject({ userId: 7, source: 'koreader', deviceId: DEVICE_ID, bookId: 20, bookFileId: 10 });
    expect(params.annotations[0]).toMatchObject({
      datetime: '2026-06-01 21:14:03',
      datetimeUpdated: '2026-06-03 09:30:00',
      drawer: 'lighten',
      color: 'red',
      note: 'edited note',
      posFormat: 'xpointer',
      pos0: '/body/DocFragment[8]/body/p[12]/text().0',
    });
    expect(result.results[0]).toEqual({ hash: HASH_A, upserted: 1 });
  });

  it('counts created, updated and moved annotations as upserted', async () => {
    annotationSync.ingestDeviceAnnotations.mockResolvedValue({ created: 1, updated: 2, moved: 1, unchanged: 3, skippedDeleted: 1 });

    const result = await service.uploadAnnotations(makeUser(), makeDto([{ hash: HASH_A, annotations: [makeAnnotation()] }]));

    expect(result.results[0]).toEqual({ hash: HASH_A, upserted: 4 });
  });

  it('reports unmatched hashes without ingesting', async () => {
    const result = await service.uploadAnnotations(makeUser(), makeDto([{ hash: HASH_B, annotations: [makeAnnotation()] }]));

    expect(result.unmatched).toEqual([HASH_B]);
    expect(annotationSync.ingestDeviceAnnotations).not.toHaveBeenCalled();
  });

  it('rejects requests with more than 50 annotations in total', async () => {
    const annotations = Array.from({ length: 51 }, (_, i) =>
      makeAnnotation({ datetime: `2026-06-01 21:14:${String(i % 60).padStart(2, '0')}`, pos0: `pos-${i}` }),
    );

    await expect(service.uploadAnnotations(makeUser(), makeDto([{ hash: HASH_A, annotations }]))).rejects.toBeInstanceOf(BadRequestException);
  });
});
