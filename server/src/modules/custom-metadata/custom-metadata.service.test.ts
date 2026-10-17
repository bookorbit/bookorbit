import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomMetadataService } from './custom-metadata.service';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');

function makeRepository() {
  const tx = { id: 'tx' };
  return {
    tx,
    repository: {
      listFields: vi.fn(),
      listEnablements: vi.fn(),
      countValuesByFieldAndLibrary: vi.fn().mockResolvedValue([]),
      findFieldById: vi.fn(),
      findFieldByKey: vi.fn(),
      createField: vi.fn(),
      updateField: vi.fn(),
      replaceEnabledLibraries: vi.fn(),
      findLibrariesByIds: vi.fn(),
      findEnabledFieldsForLibrary: vi.fn(),
      findValuesForBook: vi.fn(),
      findValuesForBooks: vi.fn(),
      findBookLibraryId: vi.fn(),
      deleteField: vi.fn(),
      deleteValue: vi.fn(),
      upsertValue: vi.fn(),
      withTransaction: vi.fn((callback: (executor: unknown) => Promise<unknown>) => callback(tx)),
    },
  };
}

function field(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    key: 'translated',
    label: 'Translated',
    type: 'boolean',
    displayOrder: 0,
    archivedAt: null,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

describe('CustomMetadataService', () => {
  let repo: ReturnType<typeof makeRepository>['repository'];
  let tx: ReturnType<typeof makeRepository>['tx'];
  let service: CustomMetadataService;

  beforeEach(() => {
    const mocked = makeRepository();
    repo = mocked.repository;
    tx = mocked.tx;
    service = new CustomMetadataService(repo as never);
  });

  it('returns stored boolean false values instead of treating them as empty', async () => {
    repo.findEnabledFieldsForLibrary.mockResolvedValue([field()]);
    repo.findValuesForBook.mockResolvedValue([
      {
        bookId: 5,
        fieldId: 7,
        valueText: null,
        valueNumber: null,
        valueDate: null,
        valueBoolean: false,
        updatedAt,
      },
    ]);

    await expect(service.getBookValues(5, 2)).resolves.toEqual([
      {
        fieldId: 7,
        key: 'translated',
        label: 'Translated',
        type: 'boolean',
        displayOrder: 0,
        value: false,
      },
    ]);
  });

  it('upserts false boolean values and deletes null values for enabled fields', async () => {
    repo.findEnabledFieldsForLibrary.mockResolvedValue([field(), field({ id: 8, key: 'mood', label: 'Mood', type: 'text' })]);

    await service.updateBookValues(
      5,
      2,
      [
        { fieldId: 7, value: false },
        { fieldId: 8, value: null },
      ],
      tx as never,
    );

    expect(repo.upsertValue).toHaveBeenCalledWith(5, 7, { valueText: null, valueNumber: null, valueDate: null, valueBoolean: false }, tx);
    expect(repo.deleteValue).toHaveBeenCalledWith(5, 8, tx);
  });

  it('rejects values for fields that are not enabled for the book library', async () => {
    repo.findEnabledFieldsForLibrary.mockResolvedValue([field({ id: 7 })]);

    await expect(service.updateBookValues(5, 2, [{ fieldId: 99, value: 'Hidden' }], tx as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsertValue).not.toHaveBeenCalled();
    expect(repo.deleteValue).not.toHaveBeenCalled();
  });

  it('parses file values for enabled custom fields and skips invalid values', async () => {
    repo.findBookLibraryId.mockResolvedValue(2);
    repo.findEnabledFieldsForLibrary.mockResolvedValue([
      field({ id: 7, key: 'translated', label: 'Translated', type: 'boolean' }),
      field({ id: 8, key: 'source_url', label: 'Source URL', type: 'url' }),
      field({ id: 9, key: 'bad_date', label: 'Bad Date', type: 'date' }),
    ]);

    await expect(
      service.parseFileValuesForBook(5, {
        translated: 'false',
        source_url: 'https://example.test/book',
        bad_date: '2026-02-31',
      }),
    ).resolves.toEqual([
      { fieldId: 7, value: false },
      { fieldId: 8, value: 'https://example.test/book' },
    ]);
  });

  it('includes usage counts per library when listing fields', async () => {
    repo.listFields.mockResolvedValue([field({ id: 7 }), field({ id: 8, key: 'mood', label: 'Mood', type: 'text' })]);
    repo.listEnablements.mockResolvedValue([{ fieldId: 7, libraryId: 2, displayOrder: 0 }]);
    repo.countValuesByFieldAndLibrary.mockResolvedValue([
      { fieldId: 7, libraryId: 2, count: 12 },
      { fieldId: 7, libraryId: 4, count: 3 },
    ]);

    const result = await service.listFields(false);

    expect(result).toEqual([
      expect.objectContaining({ id: 7, enabledLibraryIds: [2], usageCount: 15, usageByLibrary: { 2: 12, 4: 3 } }),
      expect.objectContaining({ id: 8, enabledLibraryIds: [], usageCount: 0, usageByLibrary: {} }),
    ]);
  });

  it('starts a new field with no usage', async () => {
    repo.findFieldByKey.mockResolvedValue(null);
    repo.findLibrariesByIds.mockResolvedValue([{ id: 2 }]);
    repo.createField.mockResolvedValue([field({ id: 9, key: 'shelf', label: 'Shelf', type: 'number' })]);

    await expect(service.createField({ label: 'Shelf', type: 'number', enabledLibraryIds: [2] })).resolves.toEqual(
      expect.objectContaining({ id: 9, enabledLibraryIds: [2], usageCount: 0, usageByLibrary: {} }),
    );
  });

  it('reports the edited field’s usage per library after an update, counting only that field', async () => {
    repo.findFieldById.mockResolvedValue(field({ id: 7 }));
    repo.findLibrariesByIds.mockResolvedValue([{ id: 2 }]);
    repo.countValuesByFieldAndLibrary.mockResolvedValue([
      { fieldId: 7, libraryId: 2, count: 5 },
      { fieldId: 7, libraryId: 6, count: 1 },
    ]);

    const result = await service.updateField(7, { enabledLibraryIds: [2] });

    expect(repo.countValuesByFieldAndLibrary).toHaveBeenCalledWith(7);
    expect(result).toEqual(expect.objectContaining({ enabledLibraryIds: [2], usageCount: 6, usageByLibrary: { 2: 5, 6: 1 } }));
  });

  it('reorders fields by setting display order to the requested index', async () => {
    repo.listFields.mockResolvedValueOnce([field({ id: 7 }), field({ id: 8 }), field({ id: 9 })]);
    repo.listFields.mockResolvedValueOnce([]);
    repo.listEnablements.mockResolvedValue([]);
    repo.updateField.mockResolvedValue([field()]);

    await service.reorderFields([9, 7, 8]);

    expect(repo.updateField).toHaveBeenNthCalledWith(1, 9, expect.objectContaining({ displayOrder: 0 }), tx);
    expect(repo.updateField).toHaveBeenNthCalledWith(2, 7, expect.objectContaining({ displayOrder: 1 }), tx);
    expect(repo.updateField).toHaveBeenNthCalledWith(3, 8, expect.objectContaining({ displayOrder: 2 }), tx);
  });

  it('rejects a reorder that does not cover every active field exactly once', async () => {
    repo.listFields.mockResolvedValue([field({ id: 7 }), field({ id: 8 })]);

    await expect(service.reorderFields([7])).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateField).not.toHaveBeenCalled();
  });
});
