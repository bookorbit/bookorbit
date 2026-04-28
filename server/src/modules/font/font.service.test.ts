import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FontService } from './font.service';
import type { FontRepository } from './font.repository';
import type { FontStorageService } from './font.storage.service';
import type { FontValidationService } from './font.validation.service';
import type { RequestUser } from '../../common/types/request-user';
import type { UserFontRow } from '../../db/schema';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

function makeFontRow(overrides: Partial<UserFontRow> = {}): UserFontRow {
  return {
    id: 1,
    userId: 1,
    familyName: 'Literata',
    originalFileName: 'Literata-Regular.ttf',
    storedFileName: 'uuid.ttf',
    format: 'ttf',
    weight: 400,
    style: 'normal',
    fileSize: 50000,
    fileHash: 'abc123hash',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTTFBuffer(): Buffer {
  return Buffer.from([0x00, 0x01, 0x00, 0x00, ...Array(100).fill(0)]);
}

describe('FontService', () => {
  let service: FontService;
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let storage: Record<string, ReturnType<typeof vi.fn>>;
  let validation: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    repo = {
      findAllByUser: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      findByUserAndHash: vi.fn().mockResolvedValue(undefined),
      countByUser: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteAllByUser: vi.fn(),
    };

    storage = {
      save: vi.fn().mockResolvedValue('stored-uuid.ttf'),
      delete: vi.fn().mockResolvedValue(undefined),
      getPathIfExists: vi.fn().mockResolvedValue('/app-data/users/1/fonts/stored-uuid.ttf'),
      getPath: vi.fn().mockReturnValue('/app-data/users/1/fonts/stored-uuid.ttf'),
    };

    validation = {
      validateFormat: vi.fn(),
      extractMetadata: vi.fn().mockReturnValue({
        familyName: 'Literata',
        weight: 400,
        style: 'normal',
      }),
    };

    service = new FontService(
      repo as unknown as FontRepository,
      storage as unknown as FontStorageService,
      validation as unknown as FontValidationService,
    );
  });

  describe('list', () => {
    it('returns all fonts for a user mapped to response format', async () => {
      const row = makeFontRow();
      repo.findAllByUser.mockResolvedValue([row]);

      const result = await service.list(1);

      expect(repo.findAllByUser).toHaveBeenCalledWith(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        familyName: 'Literata',
        originalFileName: 'Literata-Regular.ttf',
        format: 'ttf',
        weight: 400,
        style: 'normal',
        fileSize: 50000,
        createdAt: row.createdAt.toISOString(),
      });
    });

    it('returns empty array when user has no fonts', async () => {
      repo.findAllByUser.mockResolvedValue([]);
      const result = await service.list(1);
      expect(result).toEqual([]);
    });
  });

  describe('upload', () => {
    it('validates, saves, and creates a font record', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();
      const row = makeFontRow();
      repo.create.mockResolvedValue(row);

      const result = await service.upload(user, buffer, 'Literata-Regular.ttf');

      expect(validation.validateFormat).toHaveBeenCalledWith(buffer, 'ttf');
      expect(storage.save).toHaveBeenCalledWith(1, 'ttf', buffer);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          familyName: 'Literata',
          originalFileName: 'Literata-Regular.ttf',
          format: 'ttf',
          weight: 400,
          style: 'normal',
        }),
      );
      expect(result.font.familyName).toBe('Literata');
      expect(result.suggestedFamilyName).toBe('Literata');
    });

    it('rejects files exceeding size limit', async () => {
      const user = makeUser();
      const buffer = Buffer.alloc(11 * 1024 * 1024);

      await expect(service.upload(user, buffer, 'big.ttf')).rejects.toThrow(BadRequestException);
    });

    it('rejects unsupported file extensions', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();

      await expect(service.upload(user, buffer, 'font.svg')).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate uploads', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();
      repo.findByUserAndHash.mockResolvedValue(makeFontRow());

      await expect(service.upload(user, buffer, 'Literata.ttf')).rejects.toThrow(ConflictException);
    });

    it('rejects when user has reached font limit', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();
      repo.countByUser.mockResolvedValue(50);

      await expect(service.upload(user, buffer, 'Literata.ttf')).rejects.toThrow(BadRequestException);
    });

    it('cleans up stored file if DB insert fails', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();
      repo.create.mockRejectedValue(new Error('DB error'));

      await expect(service.upload(user, buffer, 'Literata.ttf')).rejects.toThrow();
      expect(storage.delete).toHaveBeenCalledWith(1, 'stored-uuid.ttf');
    });

    it('uses fallback family name when metadata extraction returns null', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();
      validation.extractMetadata.mockReturnValue({ familyName: null, weight: 400, style: 'normal' });
      const row = makeFontRow({ familyName: 'Literata' });
      repo.create.mockResolvedValue(row);

      await service.upload(user, buffer, 'Literata-Regular.ttf');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          familyName: 'Literata',
        }),
      );
    });

    it('uses "Custom Font" as fallback when filename yields empty name', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();
      validation.extractMetadata.mockReturnValue({ familyName: null, weight: 400, style: 'normal' });
      const row = makeFontRow({ familyName: 'Custom Font' });
      repo.create.mockResolvedValue(row);

      await service.upload(user, buffer, 'Regular.ttf');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          familyName: 'Custom Font',
        }),
      );
    });
    it('returns suggestedFamilyName as null when font has no parseable family name', async () => {
      const user = makeUser();
      const buffer = makeTTFBuffer();
      validation.extractMetadata.mockReturnValue({ familyName: null, weight: 400, style: 'normal' });
      const row = makeFontRow({ familyName: 'Custom Font' });
      repo.create.mockResolvedValue(row);

      const result = await service.upload(user, buffer, 'Regular.ttf');

      expect(result.suggestedFamilyName).toBeNull();
    });
  });

  describe('update', () => {
    it('updates font metadata', async () => {
      const user = makeUser();
      const font = makeFontRow();
      repo.findById.mockResolvedValue(font);
      const updated = makeFontRow({ familyName: 'New Name', weight: 700 });
      repo.update.mockResolvedValue(updated);

      const result = await service.update(user, 1, { familyName: 'New Name', weight: 700 });

      expect(repo.update).toHaveBeenCalledWith(1, { familyName: 'New Name', weight: 700 });
      expect(result.familyName).toBe('New Name');
    });

    it('returns current font when no fields to update', async () => {
      const user = makeUser();
      const font = makeFontRow();
      repo.findById.mockResolvedValue(font);

      const result = await service.update(user, 1, {});

      expect(repo.update).not.toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('throws NotFoundException when repo.update returns undefined (concurrent delete race)', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(makeFontRow());
      repo.update.mockResolvedValue(undefined);

      await expect(service.update(user, 1, { familyName: 'Race' })).rejects.toThrow(NotFoundException);
    });

    it('rejects when font not found', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(undefined);

      await expect(service.update(user, 999, { familyName: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('rejects when user does not own font', async () => {
      const user = makeUser({ id: 2 });
      repo.findById.mockResolvedValue(makeFontRow({ userId: 1 }));

      await expect(service.update(user, 1, { familyName: 'X' })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('deletes font from DB and storage', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(makeFontRow());

      await service.remove(user, 1);

      expect(repo.delete).toHaveBeenCalledWith(1);
      expect(storage.delete).toHaveBeenCalledWith(1, 'uuid.ttf');
    });

    it('rejects when font not found', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(undefined);

      await expect(service.remove(user, 999)).rejects.toThrow(NotFoundException);
    });

    it('rejects when user does not own font', async () => {
      const user = makeUser({ id: 2 });
      repo.findById.mockResolvedValue(makeFontRow({ userId: 1 }));

      await expect(service.remove(user, 1)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getFileInfo', () => {
    it('returns file path and font info', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(makeFontRow());

      const result = await service.getFileInfo(user, 1);

      expect(result.filePath).toBe('/app-data/users/1/fonts/stored-uuid.ttf');
      expect(result.font).toBeDefined();
    });

    it('rejects when file does not exist on disk', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(makeFontRow());
      storage.getPathIfExists.mockResolvedValue(null);

      await expect(service.getFileInfo(user, 1)).rejects.toThrow(NotFoundException);
    });

    it('rejects when user does not own font', async () => {
      const user = makeUser({ id: 2 });
      repo.findById.mockResolvedValue(makeFontRow({ userId: 1 }));

      await expect(service.getFileInfo(user, 1)).rejects.toThrow(ForbiddenException);
    });
  });
});
