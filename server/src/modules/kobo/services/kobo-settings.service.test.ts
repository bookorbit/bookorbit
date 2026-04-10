import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

import { KoboSettingsService } from './kobo-settings.service';

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 9,
    readingThreshold: 2,
    finishedThreshold: 90,
    convertToKepub: false,
    twoWayProgressSync: true,
    forceEnableHyphenation: false,
    kepubConversionLimitMb: 100,
    ...overrides,
  };
}

function makeDb() {
  const findFirst = vi.fn();

  const insertReturning = vi.fn();
  const insertOnConflictDoNothing = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: insertOnConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateReturning = vi.fn();
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    query: {
      koboSyncSettings: {
        findFirst,
      },
    },
    insert,
    insertValues,
    insertOnConflictDoNothing,
    insertReturning,
    update,
    updateSet,
    updateWhere,
    updateReturning,
  };
}

describe('KoboSettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing settings row when present', async () => {
    const db = makeDb();
    db.query.koboSyncSettings.findFirst.mockResolvedValue(makeRow({ readingThreshold: 1.5 }));
    const service = new KoboSettingsService(db as never);

    await expect(service.getSettings(9)).resolves.toEqual({
      readingThreshold: 1.5,
      finishedThreshold: 90,
      convertToKepub: false,
      twoWayProgressSync: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 100,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates missing settings row and falls back to re-read when insert returns nothing', async () => {
    const db = makeDb();
    db.query.koboSyncSettings.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(makeRow({ readingThreshold: 3 }));
    db.insertReturning.mockResolvedValueOnce([]);
    const service = new KoboSettingsService(db as never);

    await expect(service.getSettings(7)).resolves.toEqual({
      readingThreshold: 3,
      finishedThreshold: 90,
      convertToKepub: false,
      twoWayProgressSync: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 100,
    });
    expect(db.insertValues).toHaveBeenCalledWith({ userId: 7 });
  });

  it('throws when settings row cannot be created', async () => {
    const db = makeDb();
    db.query.koboSyncSettings.findFirst.mockResolvedValue(null);
    db.insertReturning.mockResolvedValue([]);
    const service = new KoboSettingsService(db as never);

    await expect(service.getSettings(7)).rejects.toThrow(InternalServerErrorException);
  });

  it('rejects threshold updates where reading threshold is not below finished threshold', async () => {
    const db = makeDb();
    const service = new KoboSettingsService(db as never);
    vi.spyOn(service, 'getSettings').mockResolvedValue({
      readingThreshold: 2,
      finishedThreshold: 90,
      convertToKepub: false,
      twoWayProgressSync: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 100,
    });

    await expect(service.updateSettings(9, { readingThreshold: 95 })).rejects.toThrow(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates and returns merged settings fields', async () => {
    const db = makeDb();
    const service = new KoboSettingsService(db as never);
    vi.spyOn(service, 'getSettings').mockResolvedValue({
      readingThreshold: 2,
      finishedThreshold: 90,
      convertToKepub: false,
      twoWayProgressSync: false,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 100,
    });
    db.updateReturning.mockResolvedValue([
      makeRow({
        readingThreshold: 3,
        finishedThreshold: 95,
        convertToKepub: true,
        twoWayProgressSync: true,
        forceEnableHyphenation: true,
        kepubConversionLimitMb: 200,
      }),
    ]);

    await expect(service.updateSettings(9, { readingThreshold: 3, finishedThreshold: 95, convertToKepub: true })).resolves.toEqual({
      readingThreshold: 3,
      finishedThreshold: 95,
      convertToKepub: true,
      twoWayProgressSync: true,
      forceEnableHyphenation: true,
      kepubConversionLimitMb: 200,
    });
  });

  it('throws when update does not return a row', async () => {
    const db = makeDb();
    const service = new KoboSettingsService(db as never);
    vi.spyOn(service, 'getSettings').mockResolvedValue({
      readingThreshold: 2,
      finishedThreshold: 90,
      convertToKepub: false,
      twoWayProgressSync: false,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 100,
    });
    db.updateReturning.mockResolvedValue([]);

    await expect(service.updateSettings(9, { finishedThreshold: 91 })).rejects.toThrow(InternalServerErrorException);
  });
});
