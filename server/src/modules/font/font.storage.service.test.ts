vi.mock('fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

import { Logger } from '@nestjs/common';
import { access, mkdir, unlink, writeFile } from 'fs/promises';

import { FontStorageService } from './font.storage.service';

const accessMock = vi.mocked(access);
const mkdirMock = vi.mocked(mkdir);
const unlinkMock = vi.mocked(unlink);
const writeFileMock = vi.mocked(writeFile);

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  let callCount = 0;
  return {
    ...actual,
    randomUUID: vi.fn(() => {
      callCount++;
      return `test-uuid-${callCount}`;
    }),
  };
});

describe('FontStorageService', () => {
  const loggerWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  const config = {
    get: vi.fn().mockReturnValue('/app-data'),
  };

  let service: FontStorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockReturnValue('/app-data');
    service = new FontStorageService(config as never);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('save', () => {
    it('creates the font directory and writes the file', async () => {
      const buffer = Buffer.from('font data');
      const storedFileName = await service.save(42, 'ttf', buffer);

      expect(mkdirMock).toHaveBeenCalledWith('/app-data/users/42/fonts', { recursive: true });
      expect(writeFileMock).toHaveBeenCalledWith(expect.stringContaining('/app-data/users/42/fonts/'), buffer);
      expect(storedFileName).toMatch(/\.ttf$/);
    });

    it('generates correct extension for each format', async () => {
      const buffer = Buffer.from('font data');

      const ttf = await service.save(1, 'ttf', buffer);
      expect(ttf).toMatch(/\.ttf$/);

      const otf = await service.save(1, 'otf', buffer);
      expect(otf).toMatch(/\.otf$/);

      const woff = await service.save(1, 'woff', buffer);
      expect(woff).toMatch(/\.woff$/);

      const woff2 = await service.save(1, 'woff2', buffer);
      expect(woff2).toMatch(/\.woff2$/);
    });
  });

  describe('delete', () => {
    it('deletes the file at the correct path', async () => {
      unlinkMock.mockResolvedValue(undefined);
      await service.delete(42, 'abc.ttf');
      expect(unlinkMock).toHaveBeenCalledWith('/app-data/users/42/fonts/abc.ttf');
    });

    it('silently ignores ENOENT errors', async () => {
      unlinkMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      await expect(service.delete(42, 'abc.ttf')).resolves.toBeUndefined();
      expect(loggerWarn).not.toHaveBeenCalled();
    });

    it('logs a warning for non-ENOENT errors', async () => {
      unlinkMock.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
      await expect(service.delete(42, 'abc.ttf')).resolves.toBeUndefined();
      expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    });
  });

  describe('getPathIfExists', () => {
    it('returns path when file is accessible', async () => {
      accessMock.mockResolvedValue(undefined);
      const result = await service.getPathIfExists(42, 'abc.ttf');
      expect(result).toBe('/app-data/users/42/fonts/abc.ttf');
    });

    it('returns null when file is not accessible', async () => {
      accessMock.mockRejectedValue(new Error('not readable'));
      const result = await service.getPathIfExists(42, 'abc.ttf');
      expect(result).toBeNull();
    });
  });

  describe('getPath', () => {
    it('returns the full path without checking existence', () => {
      const result = service.getPath(42, 'abc.ttf');
      expect(result).toBe('/app-data/users/42/fonts/abc.ttf');
    });
  });
});
