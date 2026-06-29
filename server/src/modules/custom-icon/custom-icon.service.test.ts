import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CUSTOM_ICON_MAX_UPLOAD_FILES, CUSTOM_ICON_SLUG_MAX_LENGTH } from '@bookorbit/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomIconRow, NewCustomIcon } from '../../db/schema';
import type { CustomIconRepository } from './custom-icon.repository';
import { CustomIconService } from './custom-icon.service';
import type { CustomIconStorageService } from './custom-icon.storage.service';

const now = new Date('2026-01-01T00:00:00.000Z');

function safeSvg(): Buffer {
  return Buffer.from('<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>');
}

function makeRow(overrides: Partial<CustomIconRow> = {}): CustomIconRow {
  return {
    id: 1,
    slug: 'test-icon',
    name: 'Test Icon',
    originalFileName: 'test.svg',
    storedFileName: 'stored.svg',
    fileSize: 56,
    fileHash: 'abc123',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function rowFromInsert(data: NewCustomIcon): CustomIconRow {
  return {
    id: 1,
    slug: data.slug,
    name: data.name,
    originalFileName: data.originalFileName,
    storedFileName: data.storedFileName,
    fileSize: data.fileSize,
    fileHash: data.fileHash,
    createdAt: now,
    updatedAt: now,
  };
}

describe('CustomIconService', () => {
  let repo: {
    findAll: ReturnType<typeof vi.fn>;
    findCatalog: ReturnType<typeof vi.fn>;
    findPage: ReturnType<typeof vi.fn>;
    findBySlug: ReturnType<typeof vi.fn>;
    findExistingSlugs: ReturnType<typeof vi.fn>;
    findByHashes: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    usageBreakdown: ReturnType<typeof vi.fn>;
  };
  let storage: {
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getPathIfExists: ReturnType<typeof vi.fn>;
  };
  let service: CustomIconService;

  beforeEach(() => {
    repo = {
      findAll: vi.fn().mockResolvedValue([]),
      findCatalog: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findBySlug: vi.fn().mockResolvedValue(undefined),
      findExistingSlugs: vi.fn().mockResolvedValue([]),
      findByHashes: vi.fn().mockResolvedValue([]),
      create: vi.fn((data: NewCustomIcon) => Promise.resolve(rowFromInsert(data))),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue([]),
      usageBreakdown: vi.fn().mockResolvedValue({ libraries: 0, collections: 0, smartScopes: 0 }),
    };
    storage = {
      save: vi.fn().mockResolvedValue('stored.svg'),
      delete: vi.fn().mockResolvedValue(undefined),
      getPathIfExists: vi.fn(),
    };
    service = new CustomIconService(repo as unknown as CustomIconRepository, storage as unknown as CustomIconStorageService);
  });

  // ── catalog ───────────────────────────────────────────────────────────────

  it('catalog returns capped icons with total count', async () => {
    repo.findCatalog.mockResolvedValue({ items: [makeRow({ slug: 'star', name: 'Star', fileHash: 'h1' })], total: 1234 });

    const result = await service.catalog();

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1234);
    expect(result.items[0]).toMatchObject({ slug: 'star', name: 'Star' });
    expect(result.items[0]!.svgUrl).toContain('/custom-icons/star.svg');
  });

  // ── listPage ─────────────────────────────────────────────────────────────

  it('listPage passes params to repo and returns pagination envelope', async () => {
    repo.findPage.mockResolvedValue({ items: [makeRow()], total: 1 });

    const result = await service.listPage({ sort: 'name', page: 2, size: 10 });

    expect(repo.findPage).toHaveBeenCalledWith({ sort: 'name', page: 2, size: 10 });
    expect(result).toMatchObject({ total: 1, page: 2, size: 10 });
    expect(result.items).toHaveLength(1);
  });

  // ── stageMany ─────────────────────────────────────────────────────────────

  it('stageMany throws when no files are provided', async () => {
    await expect(service.stageMany([])).rejects.toThrow(BadRequestException);
  });

  it('stageMany throws when too many files are provided', async () => {
    const files = Array.from({ length: CUSTOM_ICON_MAX_UPLOAD_FILES + 1 }, (_, i) => ({ filename: `f${i}.svg`, bytes: safeSvg() }));
    await expect(service.stageMany(files)).rejects.toThrow(BadRequestException);
  });

  it('uses a single 1-item query when the base slug is free (fast path)', async () => {
    await service.uploadMany([{ filename: 'star.svg', bytes: safeSvg() }], [{ filename: 'star.svg', name: 'Star' }]);

    expect(repo.findExistingSlugs).toHaveBeenCalledOnce();
    expect(repo.findExistingSlugs).toHaveBeenCalledWith(['star']);
  });

  it('queries suffix candidates only when the base slug is already taken', async () => {
    repo.findExistingSlugs.mockResolvedValueOnce(['star']).mockResolvedValueOnce([]);

    await service.uploadMany([{ filename: 'star.svg', bytes: safeSvg() }], [{ filename: 'star.svg', name: 'Star' }]);

    expect(repo.findExistingSlugs).toHaveBeenCalledTimes(2);
    expect(repo.findExistingSlugs).toHaveBeenNthCalledWith(1, ['star']);
    expect(repo.findExistingSlugs).toHaveBeenNthCalledWith(2, expect.arrayContaining(['star-2']));
  });

  it('keeps auto-suffixed slugs within the max slug length', async () => {
    const baseSlug = 'a'.repeat(CUSTOM_ICON_SLUG_MAX_LENGTH);
    repo.findExistingSlugs.mockResolvedValue([baseSlug]);

    const result = await service.uploadMany([{ filename: `${baseSlug}.svg`, bytes: safeSvg() }]);

    const expectedSlug = `${'a'.repeat(CUSTOM_ICON_SLUG_MAX_LENGTH - 2)}-2`;
    expect(result.items[0]).toMatchObject({ status: 'created', icon: { slug: expectedSlug } });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ slug: expectedSlug }));
  });

  it('rejects invalid route slugs before querying storage', async () => {
    await expect(service.getFileInfo('bad slug')).rejects.toThrow(BadRequestException);
    expect(repo.findBySlug).not.toHaveBeenCalled();
    expect(storage.getPathIfExists).not.toHaveBeenCalled();
  });

  it('uses the provided name and generates its slug from that name', async () => {
    const result = await service.uploadMany([{ filename: 'icon.svg', bytes: safeSvg() }], [{ filename: 'icon.svg', name: 'My Star' }]);

    expect(result.items[0]).toMatchObject({ status: 'created' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Star', slug: 'my-star' }));
  });

  it('ignores legacy slug metadata and still derives the slug from the name', async () => {
    const metaWithLegacySlug = [{ filename: 'icon.svg', name: 'My Star', slug: 'other-slug' }] as unknown as Parameters<typeof service.uploadMany>[1];

    const result = await service.uploadMany([{ filename: 'icon.svg', bytes: safeSvg() }], metaWithLegacySlug);

    expect(result.items[0]).toMatchObject({ status: 'created', icon: { slug: 'my-star' } });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Star', slug: 'my-star' }));
  });

  it('auto-suffixes generated slugs when the name slug already exists', async () => {
    repo.findExistingSlugs.mockResolvedValue(['taken']);

    const result = await service.uploadMany([{ filename: 'icon.svg', bytes: safeSvg() }], [{ filename: 'icon.svg', name: 'Taken' }]);

    expect(result.items[0]).toMatchObject({ status: 'created', icon: { slug: 'taken-2' } });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Taken', slug: 'taken-2' }));
  });

  it('flags identical SVG content as a duplicate when staging', async () => {
    const sanitizedHash = (await service.stageMany([{ filename: 'a.svg', bytes: safeSvg() }])).items[0].fileHash!;
    repo.findByHashes.mockResolvedValue([{ slug: 'existing', name: 'Existing', fileHash: sanitizedHash }]);

    const result = await service.stageMany([{ filename: 'a.svg', bytes: safeSvg() }]);

    expect(result.items[0]).toMatchObject({ ok: true, duplicateOfSlug: 'existing', duplicateOfName: 'Existing' });
    expect(result.items[0].sanitizedSvg).toContain('<svg');
  });

  it('reports invalid files when staging without throwing', async () => {
    const result = await service.stageMany([{ filename: 'note.txt', bytes: Buffer.from('hello') }]);
    expect(result.items[0]).toMatchObject({ ok: false });
    expect(result.items[0].error).toBeTruthy();
  });

  // ── uploadMany ────────────────────────────────────────────────────────────

  it('uploadMany throws when no files are provided', async () => {
    await expect(service.uploadMany([])).rejects.toThrow(BadRequestException);
  });

  it('uploadMany throws when too many files are provided', async () => {
    const files = Array.from({ length: CUSTOM_ICON_MAX_UPLOAD_FILES + 1 }, (_, i) => ({ filename: `f${i}.svg`, bytes: safeSvg() }));
    await expect(service.uploadMany(files)).rejects.toThrow(BadRequestException);
  });

  it('uploadMany records a failed item when a file is invalid instead of throwing', async () => {
    const result = await service.uploadMany([{ filename: 'bad.txt', bytes: Buffer.from('not svg') }]);
    expect(result.items[0]).toMatchObject({ status: 'failed' });
    expect(result.items[0].error).toBeTruthy();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('uploadMany cleans up the stored file when the DB insert fails', async () => {
    repo.create.mockRejectedValue(new Error('DB error'));

    const result = await service.uploadMany([{ filename: 'icon.svg', bytes: safeSvg() }]);

    expect(result.items[0]).toMatchObject({ status: 'failed' });
    expect(storage.save).toHaveBeenCalledOnce();
    expect(storage.delete).toHaveBeenCalledWith('stored.svg');
  });

  it('uploadMany reserves slugs across files to avoid conflicts in a single batch', async () => {
    const result = await service.uploadMany([
      { filename: 'arrow.svg', bytes: safeSvg() },
      { filename: 'arrow.svg', bytes: safeSvg() },
    ]);

    const slugs = result.items.map((item) => item.icon?.slug);
    expect(slugs[0]).toBe('arrow');
    expect(slugs[1]).toBe('arrow-2');
  });

  // ── update ────────────────────────────────────────────────────────────────

  it('bulk removes valid slugs and reports the rest as failed', async () => {
    repo.deleteMany.mockResolvedValue([
      rowFromInsert({ slug: 'a', name: 'A', originalFileName: 'a', storedFileName: 'a.svg', fileSize: 1, fileHash: 'h' }),
    ]);

    const result = await service.bulkRemove(['a', 'missing', 'bad slug']);

    expect(repo.deleteMany).toHaveBeenCalledWith(['a', 'missing']);
    expect(result.deleted).toEqual(['a']);
    expect(result.failed).toEqual(['missing']);
    expect(storage.delete).toHaveBeenCalledWith('a.svg');
  });

  it('throws when bulk delete receives no valid slugs', async () => {
    await expect(service.bulkRemove(['bad slug'])).rejects.toThrow(BadRequestException);
  });

  it('update is a no-op when name is not provided', async () => {
    const row = makeRow();
    repo.findBySlug.mockResolvedValue(row);

    const result = await service.update('test-icon', {});

    expect(repo.update).not.toHaveBeenCalled();
    expect(result.slug).toBe('test-icon');
  });

  it('update throws NotFoundException when the icon is removed between find and update', async () => {
    repo.findBySlug.mockResolvedValue(makeRow());
    repo.update.mockResolvedValue(undefined);

    await expect(service.update('test-icon', { name: 'New' })).rejects.toThrow(NotFoundException);
  });

  it('renames an icon without changing its slug', async () => {
    repo.findBySlug.mockResolvedValue(
      rowFromInsert({ slug: 'a', name: 'Old', originalFileName: 'a', storedFileName: 'a.svg', fileSize: 1, fileHash: 'h' }),
    );
    repo.update.mockResolvedValue(
      rowFromInsert({
        slug: 'a',
        name: 'New Name',
        originalFileName: 'a',
        storedFileName: 'a.svg',
        fileSize: 1,
        fileHash: 'h',
      }),
    );

    const result = await service.update('a', { name: 'New Name' });

    expect(result).toMatchObject({ name: 'New Name', slug: 'a' });
    expect(repo.update).toHaveBeenCalledWith('a', { name: 'New Name' });
  });

  // ── replaceSvg ────────────────────────────────────────────────────────────

  it('replaceSvg saves a new file, updates the DB, and deletes the old file', async () => {
    const existingRow = makeRow({ storedFileName: 'old.svg', fileHash: 'oldhash' });
    repo.findBySlug.mockResolvedValue(existingRow);
    storage.save.mockResolvedValue('new.svg');
    const updatedRow = makeRow({ storedFileName: 'new.svg' });
    repo.update.mockResolvedValue(updatedRow);

    await service.replaceSvg('test-icon', 'new.svg', safeSvg());

    expect(storage.save).toHaveBeenCalledOnce();
    expect(storage.delete).toHaveBeenCalledWith('old.svg');
    expect(repo.update).toHaveBeenCalledWith('test-icon', expect.objectContaining({ storedFileName: 'new.svg' }));
  });

  it('replaceSvg cleans up the new file and rethrows when the DB update fails', async () => {
    repo.findBySlug.mockResolvedValue(makeRow());
    storage.save.mockResolvedValue('new.svg');
    repo.update.mockRejectedValue(new Error('DB error'));

    await expect(service.replaceSvg('test-icon', 'icon.svg', safeSvg())).rejects.toThrow('DB error');

    expect(storage.delete).toHaveBeenCalledWith('new.svg');
  });

  it('replaceSvg cleans up the new file when the icon is not found during update', async () => {
    repo.findBySlug.mockResolvedValue(makeRow());
    storage.save.mockResolvedValue('new.svg');
    repo.update.mockResolvedValue(undefined);

    await expect(service.replaceSvg('test-icon', 'icon.svg', safeSvg())).rejects.toThrow(NotFoundException);

    expect(storage.delete).toHaveBeenCalledWith('new.svg');
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it('remove deletes the icon and its file', async () => {
    repo.delete.mockResolvedValue(makeRow({ storedFileName: 'file.svg' }));

    await service.remove('test-icon');

    expect(repo.delete).toHaveBeenCalledWith('test-icon');
    expect(storage.delete).toHaveBeenCalledWith('file.svg');
  });

  it('remove throws NotFoundException when the icon does not exist', async () => {
    repo.delete.mockResolvedValue(undefined);

    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });

  // ── getFileInfo ───────────────────────────────────────────────────────────

  it('getFileInfo returns the file path and icon row', async () => {
    repo.findBySlug.mockResolvedValue(makeRow({ storedFileName: 'icon.svg' }));
    storage.getPathIfExists.mockResolvedValue('/data/icons/icon.svg');

    const result = await service.getFileInfo('test-icon');

    expect(result.filePath).toBe('/data/icons/icon.svg');
    expect(result.icon.slug).toBe('test-icon');
  });

  it('getFileInfo throws NotFoundException when the file is missing on disk', async () => {
    repo.findBySlug.mockResolvedValue(makeRow());
    storage.getPathIfExists.mockResolvedValue(null);

    await expect(service.getFileInfo('test-icon')).rejects.toThrow(NotFoundException);
  });

  // ── getUsage ──────────────────────────────────────────────────────────────

  it('returns a usage total with breakdown', async () => {
    repo.findBySlug.mockResolvedValue(
      rowFromInsert({ slug: 'a', name: 'A', originalFileName: 'a', storedFileName: 'a.svg', fileSize: 1, fileHash: 'h' }),
    );
    repo.usageBreakdown.mockResolvedValue({ libraries: 2, collections: 1, smartScopes: 0 });

    const usage = await service.getUsage('a');

    expect(usage).toEqual({ total: 3, libraries: 2, collections: 1, smartScopes: 0 });
  });

  it('getUsage throws when slug is invalid', async () => {
    await expect(service.getUsage('bad slug!')).rejects.toThrow(BadRequestException);
  });

  // ── nextAvailableSlug conflict ─────────────────────────────────────────────

  it('records a conflict as a failed item when all 999 slug candidates are taken', async () => {
    const base = 'icon'; // derived from 'icon.svg' by displayNameFromFilename → slugifyIconName
    const allCandidates = [base, ...Array.from({ length: 998 }, (_, i) => `${base}-${i + 2}`)];
    repo.findExistingSlugs.mockResolvedValue(allCandidates);

    const result = await service.uploadMany([{ filename: 'icon.svg', bytes: safeSvg() }]);

    expect(result.items[0]).toMatchObject({ status: 'failed' });
    expect(result.items[0].error).toContain('slug');
  });
});
