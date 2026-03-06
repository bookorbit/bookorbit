import { DEFAULT_FILE_WRITE_SETTINGS } from '@projectx/types';

import { FileWriteSettingsService } from './file-write-settings.service';

describe('FileWriteSettingsService', () => {
  function makeDb() {
    const findFirst = jest.fn();
    const insertChain = {
      values: jest.fn().mockReturnThis(),
      onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    };

    return {
      query: {
        appSettings: {
          findFirst,
        },
      },
      insert: jest.fn().mockReturnValue(insertChain),
      __chains: { findFirst, insertChain },
    };
  }

  it('returns defaults when settings are missing', async () => {
    const db = makeDb();
    db.__chains.findFirst.mockResolvedValue(null);

    const service = new FileWriteSettingsService(db as never);

    await expect(service.getGlobal()).resolves.toEqual(DEFAULT_FILE_WRITE_SETTINGS);
  });

  it('returns defaults when stored json is invalid', async () => {
    const db = makeDb();
    db.__chains.findFirst.mockResolvedValue({ value: '{not-json' });

    const service = new FileWriteSettingsService(db as never);

    await expect(service.getGlobal()).resolves.toEqual(DEFAULT_FILE_WRITE_SETTINGS);
  });

  it('merges nested settings patch over defaults', async () => {
    const db = makeDb();
    db.__chains.findFirst.mockResolvedValue({
      value: JSON.stringify({
        enabled: true,
        epub: { maxFileSizeBytes: 111 },
        cbx: { formats: ['cb7'] },
      }),
    });

    const service = new FileWriteSettingsService(db as never);
    const settings = await service.getGlobal();

    expect(settings.enabled).toBe(true);
    expect(settings.writeCover).toBe(DEFAULT_FILE_WRITE_SETTINGS.writeCover);
    expect(settings.epub).toEqual({ enabled: true, maxFileSizeBytes: 111 });
    expect(settings.pdf).toEqual(DEFAULT_FILE_WRITE_SETTINGS.pdf);
    expect(settings.cbx.formats).toEqual(['cb7']);
  });

  it('upserts merged global settings', async () => {
    const db = makeDb();
    db.__chains.findFirst.mockResolvedValue({ value: JSON.stringify(DEFAULT_FILE_WRITE_SETTINGS) });

    const service = new FileWriteSettingsService(db as never);

    const updated = await service.updateGlobal({
      enabled: true,
      cbx: { enabled: true, formats: ['cbz'], maxFileSizeBytes: 12 },
    });

    expect(updated.enabled).toBe(true);
    expect(updated.cbx).toEqual({ enabled: true, formats: ['cbz'], maxFileSizeBytes: 12 });

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.__chains.insertChain.values).toHaveBeenCalledWith({
      key: 'file_write_settings',
      value: JSON.stringify(updated),
    });
    expect(db.__chains.insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('resolve currently delegates to global settings', async () => {
    const db = makeDb();
    db.__chains.findFirst.mockResolvedValue({ value: JSON.stringify({ enabled: true }) });

    const service = new FileWriteSettingsService(db as never);

    const result = await service.resolve(999);
    expect(result.enabled).toBe(true);
  });
});
