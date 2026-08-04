import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES, MAX_FONT_FILE_SIZE, MAX_SERVER_FONTS } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { ServerFontRow } from '../../db/schema';
import type { FontValidationService } from '../font/font.validation.service';
import { ServerFontService } from './server-font.service';
import type { ServerFontRepository } from './server-font.repository';
import type { ServerFontStorageService } from './server-font.storage.service';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 7,
    username: 'admin',
    name: 'Admin',
    email: null,
    active: true,
    isSuperuser: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeFontRow(overrides: Partial<ServerFontRow> = {}): ServerFontRow {
  return {
    id: 1,
    uploadedBy: 7,
    familyName: 'OpenDyslexic',
    originalFileName: 'OpenDyslexic-Regular.otf',
    storedFileName: 'uuid.otf',
    format: 'otf',
    weight: 400,
    style: 'normal',
    fileSize: 50000,
    fileHash: 'abc123hash',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeTTFBuffer(): Buffer {
  return Buffer.from([0x00, 0x01, 0x00, 0x00, ...Array<number>(100).fill(0)]);
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
}

describe('ServerFontService', () => {
  let service: ServerFontService;
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let storage: Record<string, ReturnType<typeof vi.fn>>;
  let validation: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    repo = {
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      findByHash: vi.fn().mockResolvedValue(undefined),
      countAll: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(makeFontRow()),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    storage = {
      save: vi.fn().mockResolvedValue('stored-uuid.ttf'),
      delete: vi.fn().mockResolvedValue(undefined),
      getPathIfExists: vi.fn().mockResolvedValue('/app-data/fonts/stored-uuid.ttf'),
    };

    validation = {
      validateFormat: vi.fn(),
      extractMetadata: vi.fn().mockReturnValue({ familyName: 'OpenDyslexic', weight: 400, style: 'normal' }),
    };

    service = new ServerFontService(
      repo as unknown as ServerFontRepository,
      storage as unknown as ServerFontStorageService,
      validation as unknown as FontValidationService,
    );
  });

  describe('list', () => {
    it('returns every server font mapped to the wire shape', async () => {
      const row = makeFontRow();
      repo.findAll.mockResolvedValue([row]);

      const result = await service.list();

      expect(result).toEqual([
        {
          id: 1,
          familyName: 'OpenDyslexic',
          originalFileName: 'OpenDyslexic-Regular.otf',
          format: 'otf',
          weight: 400,
          style: 'normal',
          fileSize: 50000,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('never leaks the stored filename or uploader to clients', async () => {
      repo.findAll.mockResolvedValue([makeFontRow()]);

      const [font] = await service.list();

      expect(font).not.toHaveProperty('storedFileName');
      expect(font).not.toHaveProperty('uploadedBy');
      expect(font).not.toHaveProperty('fileHash');
    });

    it('returns an empty list when no server fonts exist', async () => {
      repo.findAll.mockResolvedValue([]);
      await expect(service.list()).resolves.toEqual([]);
    });
  });

  describe('upload', () => {
    it('validates, stores, and records the font', async () => {
      const buffer = makeTTFBuffer();

      const result = await service.upload(makeUser(), buffer, 'OpenDyslexic-Regular.ttf');

      expect(validation.validateFormat).toHaveBeenCalledWith(buffer, 'ttf');
      expect(storage.save).toHaveBeenCalledWith('ttf', buffer);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadedBy: 7,
          familyName: 'OpenDyslexic',
          originalFileName: 'OpenDyslexic-Regular.ttf',
          format: 'ttf',
          weight: 400,
          style: 'normal',
          fileSize: buffer.length,
        }),
      );
      expect(result.font.familyName).toBe('OpenDyslexic');
      expect(result.suggestedFamilyName).toBe('OpenDyslexic');
    });

    it('records who uploaded the font', async () => {
      await service.upload(makeUser({ id: 42 }), makeTTFBuffer(), 'Font.ttf');

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ uploadedBy: 42 }));
    });

    it('rejects files over the size limit', async () => {
      const buffer = Buffer.alloc(0);
      Object.defineProperty(buffer, 'length', { value: MAX_FONT_FILE_SIZE + 1 });

      await expect(service.upload(makeUser(), buffer, 'big.ttf')).rejects.toThrow(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rejects unsupported file extensions', async () => {
      await expect(service.upload(makeUser(), makeTTFBuffer(), 'font.svg')).rejects.toThrow(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rejects a file already present in the server collection', async () => {
      repo.findByHash.mockResolvedValue(makeFontRow());

      await expect(service.upload(makeUser(), makeTTFBuffer(), 'OpenDyslexic.ttf')).rejects.toThrow(ConflictException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('dedupes globally rather than per uploader', async () => {
      repo.findByHash.mockResolvedValue(makeFontRow({ uploadedBy: 1 }));

      await expect(service.upload(makeUser({ id: 999 }), makeTTFBuffer(), 'OpenDyslexic.ttf')).rejects.toThrow(ConflictException);
    });

    it('rejects uploads once the server font cap is reached', async () => {
      repo.countAll.mockResolvedValue(MAX_SERVER_FONTS);

      await expect(service.upload(makeUser(), makeTTFBuffer(), 'Font.ttf')).rejects.toThrow(
        new BadRequestException(`Maximum of ${MAX_SERVER_FONTS} server fonts reached`),
      );
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('accepts an upload at one below the cap', async () => {
      repo.countAll.mockResolvedValue(MAX_SERVER_FONTS - 1);

      await expect(service.upload(makeUser(), makeTTFBuffer(), 'Font.ttf')).resolves.toBeDefined();
    });

    it('uses its own cap, independent of the per-user font limit', async () => {
      repo.countAll.mockResolvedValue(60);

      await expect(service.upload(makeUser(), makeTTFBuffer(), 'Font.ttf')).resolves.toBeDefined();
    });

    it('removes the stored file when the insert fails', async () => {
      repo.create.mockRejectedValue(new Error('DB error'));

      await expect(service.upload(makeUser(), makeTTFBuffer(), 'Font.ttf')).rejects.toThrow('DB error');
      expect(storage.delete).toHaveBeenCalledWith('stored-uuid.ttf');
    });

    it('reports a family/weight/style clash as a conflict rather than a server error', async () => {
      repo.create.mockRejectedValue(uniqueViolation());

      await expect(service.upload(makeUser(), makeTTFBuffer(), 'OpenDyslexic.ttf')).rejects.toThrow(ConflictException);
      expect(storage.delete).toHaveBeenCalledWith('stored-uuid.ttf');
    });

    it('detects a unique violation reported through the error cause', async () => {
      repo.create.mockRejectedValue(new Error('insert failed', { cause: { code: '23505' } }));

      await expect(service.upload(makeUser(), makeTTFBuffer(), 'OpenDyslexic.ttf')).rejects.toThrow(ConflictException);
    });

    it('falls back to the filename when the font carries no family name', async () => {
      validation.extractMetadata.mockReturnValue({ familyName: null, weight: 700, style: 'normal' });

      const result = await service.upload(makeUser(), makeTTFBuffer(), 'Atkinson-Hyperlegible-Bold.ttf');

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ familyName: 'Atkinson Hyperlegible', weight: 700 }));
      expect(result.suggestedFamilyName).toBeNull();
    });
  });

  describe('update', () => {
    it('applies the supplied fields', async () => {
      repo.findById.mockResolvedValue(makeFontRow());
      repo.update.mockResolvedValue(makeFontRow({ familyName: 'Renamed', weight: 700 }));

      const result = await service.update(1, { familyName: 'Renamed', weight: 700 });

      expect(repo.update).toHaveBeenCalledWith(1, { familyName: 'Renamed', weight: 700 });
      expect(result.familyName).toBe('Renamed');
    });

    it('skips the write when no fields were supplied', async () => {
      const row = makeFontRow();
      repo.findById.mockResolvedValue(row);

      const result = await service.update(1, {});

      expect(repo.update).not.toHaveBeenCalled();
      expect(result.familyName).toBe(row.familyName);
    });

    it('rejects an unknown font', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.update(404, { familyName: 'X' })).rejects.toThrow(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('reports a rename onto an existing family/weight/style as a conflict', async () => {
      repo.findById.mockResolvedValue(makeFontRow());
      repo.update.mockRejectedValue(uniqueViolation());

      await expect(service.update(1, { familyName: 'Literata' })).rejects.toThrow(ConflictException);
    });

    it('rejects when the row disappears between read and write', async () => {
      repo.findById.mockResolvedValue(makeFontRow());
      repo.update.mockResolvedValue(undefined);

      await expect(service.update(1, { familyName: 'Renamed' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the row and then the file', async () => {
      repo.findById.mockResolvedValue(makeFontRow({ storedFileName: 'to-delete.otf' }));

      await service.remove(1);

      expect(repo.delete).toHaveBeenCalledWith(1);
      expect(storage.delete).toHaveBeenCalledWith('to-delete.otf');
    });

    it('rejects an unknown font without touching storage', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.remove(404)).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('getFileInfo', () => {
    it('returns the resolved path and row', async () => {
      const row = makeFontRow();
      repo.findById.mockResolvedValue(row);

      const result = await service.getFileInfo(1);

      expect(storage.getPathIfExists).toHaveBeenCalledWith('uuid.otf');
      expect(result).toEqual({ filePath: '/app-data/fonts/stored-uuid.ttf', font: row });
    });

    it('rejects when the row exists but the file is gone from disk', async () => {
      repo.findById.mockResolvedValue(makeFontRow());
      storage.getPathIfExists.mockResolvedValue(null);

      await expect(service.getFileInfo(1)).rejects.toThrow(NotFoundException);
    });

    it('rejects an unknown font', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.getFileInfo(404)).rejects.toThrow(NotFoundException);
    });

    it('serves the same font to any caller, since server fonts are unowned', async () => {
      const row = makeFontRow({ uploadedBy: 1 });
      repo.findById.mockResolvedValue(row);

      await expect(service.getFileInfo(1)).resolves.toEqual({ filePath: '/app-data/fonts/stored-uuid.ttf', font: row });
    });
  });
});
