import { Test } from '@nestjs/testing';

import { parseChapterDocument } from '../position-converter/position-converter.core';
import { PositionConverterService } from '../position-converter/position-converter.service';
import { AnnotationConversionService } from './annotation-conversion.service';
import { AnnotationPositionRepository } from './annotation-position.repository';
import type { AnnotationWithCfi } from './annotation.repository';
import { AnnotationSyncService } from './annotation-sync.service';

const TEXT = 'A sentence shared by both editions.';
const CFI = `epubcfi(/6/2!/4/2,/1:0,/1:${TEXT.length})`;

async function setup() {
  const target = parseChapterDocument(`<html><body><p><span id="sentence">${TEXT}</span></p></body></html>`);
  const missing = parseChapterDocument('<html><body><p>A different edition.</p></body></html>');
  const converter = new PositionConverterService({ getChapter: vi.fn((id: number) => Promise.resolve(id === 2 ? target : missing)) } as never);
  const sync = { upsertGeneratedPosition: vi.fn() };
  const module = await Test.createTestingModule({
    providers: [
      AnnotationConversionService,
      { provide: PositionConverterService, useValue: converter },
      { provide: AnnotationPositionRepository, useValue: {} },
      { provide: AnnotationSyncService, useValue: sync },
    ],
  }).compile();
  const row = { id: 1, cfi: CFI, text: TEXT, jumpFileId: 1, cfiStatus: 'exact', cfiExtras: null } as AnnotationWithCfi;
  return { service: module.get(AnnotationConversionService), converter, sync, row };
}

describe('Annotation reader position projection', () => {
  it('repairs a sibling DOM range without overwriting the source position', async () => {
    const { service, converter, sync, row } = await setup();
    const [projected] = await service.projectReaderPositions([row], 2);

    expect(projected).toEqual(expect.objectContaining({ jumpFileId: 2, cfiStatus: expect.stringMatching(/^(exact|repaired)$/), text: TEXT }));
    expect(projected!.cfi).not.toBe(CFI);
    await expect(converter.cfiToXpointer({ bookFileId: 2, cfi: projected!.cfi!, text: TEXT })).resolves.toEqual(
      expect.objectContaining({ status: 'exact' }),
    );
    expect(row.cfi).toBe(CFI);
    expect(row.jumpFileId).toBe(1);
    expect(sync.upsertGeneratedPosition).not.toHaveBeenCalled();
  });

  it('leaves a CFI that already belongs to the reader file as stored, without converting it', async () => {
    const { service, converter, row } = await setup();
    const cfiToXpointer = vi.spyOn(converter, 'cfiToXpointer');
    const own = { ...row, cfiFileId: 2, jumpFileId: 2 };

    const [projected] = await service.projectReaderPositions([own], 2);

    expect(projected).toBe(own);
    expect(cfiToXpointer).not.toHaveBeenCalled();
  });

  it('keeps an unresolvable annotation recoverable without drawing its source CFI', async () => {
    const { service, row } = await setup();
    const [projected] = await service.projectReaderPositions([row], 3);

    expect(projected).toEqual(expect.objectContaining({ cfi: null, cfiStatus: 'failed', text: TEXT, jumpFileId: 1 }));
    expect(row.cfi).toBe(CFI);
  });
});
