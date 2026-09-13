import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { TestPathMappingDto } from './download-client.dto';

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
