import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  KOREADER_CATALOG_SETTABLE_READ_STATUSES,
  KoreaderCatalogDashboardQueryDto,
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
