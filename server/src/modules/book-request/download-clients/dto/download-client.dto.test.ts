import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateDownloadClientDto, TestPathMappingDto, UpdateDownloadClientDto, ValidateDownloadClientDto } from './download-client.dto';

const validationOptions = { whitelist: true, forbidNonWhitelisted: true } as const;

describe('TestPathMappingDto', () => {
  it('accepts and transforms a positive mapping id', async () => {
    const dto = plainToInstance(TestPathMappingDto, { mappingId: '7' });

    expect(dto.mappingId).toBe(7);
    await expect(validate(dto, validationOptions)).resolves.toEqual([]);
  });

  it.each([{ mappingId: 0 }, { mappingId: 1.5 }, { mappingId: 'not-a-number' }, { localPath: '/path/to/library' }])(
    'rejects an invalid or legacy payload: %o',
    async (payload) => {
      const dto = plainToInstance(TestPathMappingDto, payload);
      expect(await validate(dto, validationOptions)).not.toEqual([]);
    },
  );
});

describe('ValidateDownloadClientDto', () => {
  it('accepts a valid payload with optional credentials', async () => {
    const dto = plainToInstance(ValidateDownloadClientDto, {
      adapterType: 'torbox',
      baseUrl: 'https://api.torbox.app',
      username: 'operator',
      password: 'api-key',
      allowPrivateAddress: true,
    });

    await expect(validate(dto, validationOptions)).resolves.toEqual([]);
  });

  it('rejects an unknown adapter type', async () => {
    const dto = plainToInstance(ValidateDownloadClientDto, { adapterType: 'unknown', baseUrl: 'https://example.com' });

    expect(await validate(dto, validationOptions)).not.toEqual([]);
  });

  it.each([{ baseUrl: undefined }, { baseUrl: '' }])('rejects a missing or empty base URL: %o', async (payload) => {
    const dto = plainToInstance(ValidateDownloadClientDto, { adapterType: 'torbox', ...payload });

    expect(await validate(dto, validationOptions)).not.toEqual([]);
  });

  it.each([{ username: 'u'.repeat(256) }, { password: 'p'.repeat(1025) }])('rejects credentials over their maximum length: %o', async (payload) => {
    const dto = plainToInstance(ValidateDownloadClientDto, { adapterType: 'torbox', baseUrl: 'https://example.com', ...payload });

    expect(await validate(dto, validationOptions)).not.toEqual([]);
  });

  it('accepts omitted optional credentials', async () => {
    const dto = plainToInstance(ValidateDownloadClientDto, { adapterType: 'torbox', baseUrl: 'https://example.com' });

    await expect(validate(dto, validationOptions)).resolves.toEqual([]);
  });

  it('rejects a non-boolean private-address choice', async () => {
    const dto = plainToInstance(ValidateDownloadClientDto, {
      adapterType: 'torbox',
      baseUrl: 'https://example.com',
      allowPrivateAddress: 'true',
    });

    expect(await validate(dto, validationOptions)).not.toEqual([]);
  });
});

describe.each([
  ['CreateDownloadClientDto', CreateDownloadClientDto, { name: 'qbit', adapterType: 'qbittorrent', baseUrl: 'http://127.0.0.1:8080' }],
  ['UpdateDownloadClientDto', UpdateDownloadClientDto, {}],
] as const)('%s category overrides', (_name, Dto, base) => {
  it('accepts a payload from an older caller that sends neither override', async () => {
    expect(await validate(plainToInstance(Dto, base), validationOptions)).toEqual([]);
  });

  it('accepts an override, a blank one and null', async () => {
    const dto = plainToInstance(Dto, { ...base, audiobookCategory: 'bookorbit audio-1.0', comicCategory: null });
    expect(await validate(dto, validationOptions)).toEqual([]);
    expect(await validate(plainToInstance(Dto, { ...base, audiobookCategory: '', comicCategory: '' }), validationOptions)).toEqual([]);
  });

  it.each([
    ['a path separator', 'books/audio'],
    ['a label separator', 'audio,books'],
    ['a non-string', 42],
    ['more than 100 characters', 'a'.repeat(101)],
  ])('rejects an override with %s', async (_case, value) => {
    expect(await validate(plainToInstance(Dto, { ...base, audiobookCategory: value }), validationOptions)).not.toEqual([]);
    expect(await validate(plainToInstance(Dto, { ...base, comicCategory: value }), validationOptions)).not.toEqual([]);
  });
});
