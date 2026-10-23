import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { BookmarkExchangeDto } from './koreader-bookmark-exchange.dto';
import { AnnotationExchangeAckDto, AnnotationExchangeDto } from './koreader-exchange.dto';

const DEVICE = { deviceId: '40A755B5', deviceModel: 'Emulator', pluginVersion: '0.4.0' };
const HASH = '5f4dcc3b5aa765d61d8327deb882cf99';

const APPLIED_ENTRY = {
  serverId: 123,
  version: 1,
  status: 'applied',
  verified: true,
  corrected: false,
  pos0: '/body/DocFragment[8]/body/p[12]/text().0',
  pos1: '/body/DocFragment[8]/body/p[12]/text().42',
  datetimeUpdated: '2026-06-10 19:58:14',
};

function failedProperties(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [...(error.constraints ? [error.property] : []), ...failedProperties(error.children ?? [])]);
}

describe('AnnotationExchangeAckDto', () => {
  it('accepts an ack with applied entries and an empty deleted array', async () => {
    const dto = plainToInstance(AnnotationExchangeAckDto, {
      ...DEVICE,
      books: [{ hash: HASH, applied: [APPLIED_ENTRY], deleted: [] }],
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts an ack where both lists are empty arrays', async () => {
    const dto = plainToInstance(AnnotationExchangeAckDto, {
      ...DEVICE,
      books: [{ hash: HASH, applied: [], deleted: [] }],
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects empty lists encoded as JSON objects, as pre-fix plugins sent for empty Lua tables', async () => {
    const dto = plainToInstance(AnnotationExchangeAckDto, {
      ...DEVICE,
      books: [{ hash: HASH, applied: [APPLIED_ENTRY], deleted: {} }],
    });
    const errors = await validate(dto);

    expect(failedProperties(errors)).toContain('deleted');
  });
});

describe('sidecarState on the exchanges', () => {
  const book = (extra: Record<string, unknown>) => ({ hash: HASH, keys: [], keysComplete: true, changes: [], ...extra });

  it.each([AnnotationExchangeDto, BookmarkExchangeDto])('stays optional so older plugins keep validating (%o)', async (Dto) => {
    const errors = await validate(plainToInstance(Dto, { ...DEVICE, books: [book({})] }));

    expect(errors).toHaveLength(0);
  });

  it.each([AnnotationExchangeDto, BookmarkExchangeDto])('accepts known and new (%o)', async (Dto) => {
    for (const sidecarState of ['known', 'new']) {
      const errors = await validate(plainToInstance(Dto, { ...DEVICE, books: [book({ sidecarState })] }));
      expect(errors).toHaveLength(0);
    }
  });

  it.each([AnnotationExchangeDto, BookmarkExchangeDto])('rejects any other value (%o)', async (Dto) => {
    const errors = await validate(plainToInstance(Dto, { ...DEVICE, books: [book({ sidecarState: 'lost' })] }));

    expect(failedProperties(errors)).toContain('sidecarState');
  });
});
