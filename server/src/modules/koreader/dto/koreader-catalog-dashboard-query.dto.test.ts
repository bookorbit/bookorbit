import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { KoreaderCatalogDashboardQueryDto } from './koreader-catalog-query.dto';

describe('KoreaderCatalogDashboardQueryDto', () => {
  beforeAll(async () => {
    await Test.createTestingModule({}).compile();
  });

  it('accepts and transforms a smart-scope dashboard request', async () => {
    const dto = plainToInstance(KoreaderCatalogDashboardQueryDto, {
      section: 'smart-scope',
      smartScopeId: '42',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual({ section: 'smart-scope', smartScopeId: 42 });
  });

  it('rejects unsupported sections and invalid smart-scope identifiers', async () => {
    const unsupported = plainToInstance(KoreaderCatalogDashboardQueryDto, { section: 'authors' });
    const invalidId = plainToInstance(KoreaderCatalogDashboardQueryDto, {
      section: 'smart-scope',
      smartScopeId: '0',
    });

    await expect(validate(unsupported)).resolves.not.toHaveLength(0);
    await expect(validate(invalidId)).resolves.not.toHaveLength(0);
  });
});
