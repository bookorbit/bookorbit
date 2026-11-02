import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  KOREADER_CATALOG_SETTABLE_READ_STATUSES,
  KoreaderCatalogBooksQueryDto,
  KoreaderCatalogDashboardQueryDto,
  KoreaderCatalogSectionQueryDto,
  KoreaderCatalogSetReadStatusDto,
} from './koreader-catalog-query.dto';

// The current plugin builds its dashboard shelves from the ordinary catalog
// endpoints and no longer sends this parameter, but devices still on 1.4.x do,
// so the contract has to keep holding.
describe('KoreaderCatalogDashboardQueryDto', () => {
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

describe('KoreaderCatalogSetReadStatusDto', () => {
  // The plugin API is the only way a device can undo its own status write, so
  // "unread" has to stay in this enum. Pinning the whole list makes a later
  // trim fail here instead of stranding books on the device.
  it('offers the reset back to unread alongside the other settable statuses', () => {
    expect([...KOREADER_CATALOG_SETTABLE_READ_STATUSES]).toEqual(['unread', 'want_to_read', 'reading', 'on_hold', 'read', 'abandoned']);
  });

  it('accepts every settable status', async () => {
    for (const status of KOREADER_CATALOG_SETTABLE_READ_STATUSES) {
      const dto = plainToInstance(KoreaderCatalogSetReadStatusDto, { status });
      await expect(validate(dto), status).resolves.toHaveLength(0);
    }
  });

  it('rejects statuses outside the settable enum and every empty reset', async () => {
    for (const status of ['rereading', 'skimmed', 'Unread', 'none', '', null, undefined]) {
      const dto = plainToInstance(KoreaderCatalogSetReadStatusDto, { status });
      await expect(validate(dto), String(status)).resolves.not.toHaveLength(0);
    }
  });
});

// Sent only by plugins that saw the catalogListsV2 capability; an older plugin
// sends none of them and must keep its original defaults.
describe('KoreaderCatalogSectionQueryDto', () => {
  it('keeps the legacy request free of the list parameters', async () => {
    const dto = plainToInstance(KoreaderCatalogSectionQueryDto, { page: '2', q: 'her' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual({ page: 2, q: 'her' });
  });

  it('accepts size, sort and filter', async () => {
    const dto = plainToInstance(KoreaderCatalogSectionQueryDto, { size: '12', sort: 'name_desc', filter: 'finished' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual(expect.objectContaining({ size: 12, sort: 'name_desc', filter: 'finished' }));
    for (const sort of ['name', 'name_desc', 'books']) {
      await expect(validate(plainToInstance(KoreaderCatalogSectionQueryDto, { sort })), sort).resolves.toHaveLength(0);
    }
  });

  it('rejects sizes outside 1..100 and unknown sorts or filters', async () => {
    for (const query of [
      { size: '0' },
      { size: '101' },
      { size: '1.5' },
      { sort: 'title' },
      { sort: 'Name' },
      { filter: 'unread' },
      { filter: '' },
    ]) {
      await expect(validate(plainToInstance(KoreaderCatalogSectionQueryDto, query)), JSON.stringify(query)).resolves.not.toHaveLength(0);
    }
  });
});

describe('KoreaderCatalogBooksQueryDto sorting', () => {
  it('accepts publication-date sorting in either direction', async () => {
    for (const order of ['asc', 'desc']) {
      const dto = plainToInstance(KoreaderCatalogBooksQueryDto, { sort: 'published', order });
      await expect(validate(dto), order).resolves.toHaveLength(0);
    }
  });
});

describe('KoreaderCatalogBooksQueryDto buckets flag', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ])('parses buckets=%s', async (value, expected) => {
    const dto = plainToInstance(KoreaderCatalogBooksQueryDto, { buckets: value });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.buckets).toBe(expected);
  });

  it('leaves the flag unset when absent and rejects anything else', async () => {
    const absent = plainToInstance(KoreaderCatalogBooksQueryDto, {});
    expect(absent.buckets).toBeUndefined();
    await expect(validate(absent)).resolves.toHaveLength(0);
    await expect(validate(plainToInstance(KoreaderCatalogBooksQueryDto, { buckets: 'yes' }))).resolves.not.toHaveLength(0);
  });
});

describe('offset paging', () => {
  it('accepts an offset of zero or more on books and sections', async () => {
    for (const Dto of [KoreaderCatalogBooksQueryDto, KoreaderCatalogSectionQueryDto]) {
      const dto = plainToInstance(Dto, { offset: '44', size: '12' });
      await expect(validate(dto), Dto.name).resolves.toHaveLength(0);
      expect(dto.offset).toBe(44);
      await expect(validate(plainToInstance(Dto, { offset: '0' })), Dto.name).resolves.toHaveLength(0);
    }
  });

  it('leaves offset unset when absent and rejects negative, fractional or too deep offsets', async () => {
    expect(plainToInstance(KoreaderCatalogBooksQueryDto, {}).offset).toBeUndefined();
    for (const Dto of [KoreaderCatalogBooksQueryDto, KoreaderCatalogSectionQueryDto]) {
      for (const offset of ['-1', '1.5', 'x', '50001']) {
        await expect(validate(plainToInstance(Dto, { offset })), `${Dto.name} ${offset}`).resolves.not.toHaveLength(0);
      }
    }
  });
});
