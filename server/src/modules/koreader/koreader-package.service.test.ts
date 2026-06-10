import { BadRequestException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as unzipper from 'unzipper';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KoreaderPackageService } from './koreader-package.service';

function makeCredentialsRow(overrides?: Record<string, unknown>) {
  return {
    userId: 7,
    username: 'reader',
    passwordHash: 'stored-bcrypt-hash',
    passwordMd5: '0123456789abcdef0123456789abcdef',
    syncEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('KoreaderPackageService', () => {
  let service: KoreaderPackageService;
  let mockRepo: { findKoreaderUser: ReturnType<typeof vi.fn> };
  let pluginDir: string;

  function makeService(sourcePath?: string) {
    return new KoreaderPackageService(mockRepo as never, { koreaderPluginSourcePath: sourcePath ?? pluginDir } as never);
  }

  async function readZipEntries(zip: Buffer): Promise<Map<string, string>> {
    const directory = await unzipper.Open.buffer(zip);
    const entries = new Map<string, string>();
    for (const file of directory.files) {
      if (file.type === 'File') {
        entries.set(file.path, (await file.buffer()).toString('utf8'));
      }
    }
    return entries;
  }

  beforeAll(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'bookorbit-koplugin-test-'));
    writeFileSync(join(pluginDir, 'main.lua'), 'return {}\n');
    writeFileSync(join(pluginDir, '_meta.lua'), 'return { name = "bookorbit" }\n');
    writeFileSync(join(pluginDir, '.DS_Store'), 'junk');
    mkdirSync(join(pluginDir, 'assets'));
    writeFileSync(join(pluginDir, 'assets', 'note.txt'), 'nested\n');
  });

  afterAll(() => {
    rmSync(pluginDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    mockRepo = { findKoreaderUser: vi.fn() };
    service = makeService();
  });

  it('throws NotFoundException when no credentials exist', async () => {
    mockRepo.findKoreaderUser.mockResolvedValue(undefined);

    await expect(service.buildPluginPackage(7, 'https://books.example.com')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when stored credentials have no md5', async () => {
    mockRepo.findKoreaderUser.mockResolvedValue(makeCredentialsRow({ passwordMd5: null }));

    await expect(service.buildPluginPackage(7, 'https://books.example.com')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['not a url', 'ftp://books.example.com', ''])('rejects invalid origin %j', async (origin) => {
    mockRepo.findKoreaderUser.mockResolvedValue(makeCredentialsRow());

    await expect(service.buildPluginPackage(7, origin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws ServiceUnavailableException when the plugin source folder is missing', async () => {
    mockRepo.findKoreaderUser.mockResolvedValue(makeCredentialsRow());
    service = makeService(join(pluginDir, 'does-not-exist'));

    await expect(service.buildPluginPackage(7, 'https://books.example.com')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('builds a zip with the plugin files and a provision file', async () => {
    mockRepo.findKoreaderUser.mockResolvedValue(makeCredentialsRow());

    const zip = await service.buildPluginPackage(7, 'https://books.example.com');
    const entries = await readZipEntries(zip);

    expect(entries.has('bookorbit.koplugin/main.lua')).toBe(true);
    expect(entries.has('bookorbit.koplugin/_meta.lua')).toBe(true);
    expect(entries.has('bookorbit.koplugin/assets/note.txt')).toBe(true);
    expect(entries.has('bookorbit.koplugin/.DS_Store')).toBe(false);

    const provision = entries.get('bookorbit.koplugin/bookorbit_provision.lua');
    expect(provision).toBeDefined();
    expect(provision).toContain('server_url = "https://books.example.com"');
    expect(provision).toContain('username = "reader"');
    expect(provision).toContain('userkey = "0123456789abcdef0123456789abcdef"');
    expect(provision).toContain('generated_at = "');
  });

  it('normalizes the origin to scheme and host only', async () => {
    mockRepo.findKoreaderUser.mockResolvedValue(makeCredentialsRow());

    const zip = await service.buildPluginPackage(7, 'https://books.example.com:8443/library/books?tab=1');
    const entries = await readZipEntries(zip);

    expect(entries.get('bookorbit.koplugin/bookorbit_provision.lua')).toContain('server_url = "https://books.example.com:8443"');
  });

  it('escapes lua string characters in the username', async () => {
    mockRepo.findKoreaderUser.mockResolvedValue(makeCredentialsRow({ username: 'rea"der\\one' }));

    const zip = await service.buildPluginPackage(7, 'https://books.example.com');
    const entries = await readZipEntries(zip);

    expect(entries.get('bookorbit.koplugin/bookorbit_provision.lua')).toContain('username = "rea\\"der\\\\one"');
  });
});
