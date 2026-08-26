import { BadRequestException, ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';

import type { DownloadClientRow } from '../../../db/schema';
import { DownloadClientConfigService } from './download-client-config.service';

function clientRow(overrides: Partial<DownloadClientRow> = {}): DownloadClientRow {
  return {
    id: 4,
    name: 'qbit',
    color: null,
    adapterType: 'qbittorrent',
    enabled: true,
    priority: 1,
    baseUrl: 'http://203.0.113.10:8080',
    username: 'admin',
    credentialsEnc: 'cipher',
    category: 'bookorbit',
    useHardlinks: true,
    allowPrivateAddress: false,
    settings: null,
    lastTestedAt: null,
    lastTestOk: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-08-18T00:00:00Z'),
    updatedAt: new Date('2026-08-18T00:00:00Z'),
    ...overrides,
  };
}

function makeService(overrides: { repo?: Record<string, unknown>; credentials?: Record<string, unknown>; downloads?: Record<string, unknown> } = {}) {
  const repo = {
    findAll: vi.fn().mockResolvedValue([{ client: clientRow(), pathMappings: [] }]),
    findById: vi.fn().mockResolvedValue({ client: clientRow(), pathMappings: [] }),
    findPreferredEnabled: vi.fn().mockResolvedValue(clientRow()),
    create: vi.fn().mockResolvedValue(clientRow()),
    createWithPathMappings: vi.fn().mockResolvedValue(clientRow()),
    update: vi.fn().mockResolvedValue(clientRow()),
    delete: vi.fn().mockResolvedValue(undefined),
    recordTestResult: vi.fn().mockResolvedValue(undefined),
    replacePathMappings: vi.fn().mockResolvedValue(undefined),
    findAllEnabled: vi.fn().mockResolvedValue([clientRow()]),
    ...overrides.repo,
  };
  const credentials = {
    encrypt: vi.fn().mockReturnValue('cipher'),
    decrypt: vi.fn().mockReturnValue('secret'),
    isConfigured: vi.fn().mockReturnValue(true),
    ...overrides.credentials,
  };
  const adapter = { test: vi.fn().mockResolvedValue({ success: true, version: 'v5.0.3' }), forget: vi.fn() };
  const registry = { require: vi.fn().mockReturnValue(adapter), find: vi.fn().mockReturnValue(adapter) };
  const pathMappings = { testHardlink: vi.fn().mockResolvedValue({ localPathExists: true, bookDockPathExists: true, hardlinkWorks: true }) };
  const config = { getOrThrow: vi.fn().mockReturnValue('/data/book-dock') };
  const downloads = { countInFlightForClient: vi.fn().mockResolvedValue(0), ...overrides.downloads };

  const service = new DownloadClientConfigService(
    repo as never,
    credentials as never,
    registry as never,
    pathMappings as never,
    downloads as never,
    config as never,
  );
  return { service, repo, credentials, registry, adapter, pathMappings, downloads };
}

// TEST-NET-3 literal: no DNS lookup in tests, and not a private address.
/**
 * The mapping is not optional decoration: it declares the directory the import may read out of, so
 * every save the tests make has to carry one the way a real one does.
 */
const createDto = {
  name: 'qbit',
  adapterType: 'qbittorrent' as const,
  baseUrl: 'http://203.0.113.10:8080',
  pathMappings: [{ remotePath: '/downloads', localPath: '/data/torrents' }],
};

describe('DownloadClientConfigService', () => {
  it('never returns the stored credential, only whether one exists', async () => {
    const { service } = makeService();
    const {
      clients: [item],
    } = await service.findAll();

    expect(item).not.toHaveProperty('credentialsEnc');
    expect(item.hasPassword).toBe(true);
  });

  /** Told up front, because a missing key is what refuses the save rather than a bad value. */
  it('reports whether credentials can be stored at all', async () => {
    const { service } = makeService({ credentials: { isConfigured: vi.fn().mockReturnValue(false) } });
    await expect(service.findAll()).resolves.toMatchObject({ encryptionConfigured: false });
  });

  /** An approver may pick a client without being trusted with how to reach it. */
  it('summarises only compatible enabled clients as names and ids', async () => {
    const { service } = makeService({
      repo: {
        findAllEnabled: vi.fn().mockResolvedValue([clientRow()]),
      },
    });

    await expect(service.findEnabledSummaries('torrent')).resolves.toEqual([{ id: 4, name: 'qbit', color: null }]);
    // Direct files are fetched by BookOrbit itself, so there is never a client row to pick.
    await expect(service.findEnabledSummaries('file')).resolves.toEqual([]);
  });

  it('answers with nothing rather than inventing a client when none is configured', async () => {
    const { service, repo } = makeService({ repo: { findPreferredEnabled: vi.fn().mockResolvedValue(undefined) } });

    await expect(service.findPreferredEnabled(['qbittorrent'])).resolves.toBeUndefined();
    expect(repo.findAll).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('drops any cached session when the way we reach the client changes', async () => {
    const { service, adapter } = makeService();
    await service.update(4, { username: 'operator' });
    expect(adapter.forget).toHaveBeenCalledWith(4);
  });

  it('leaves the cached session alone for an edit that cannot affect it', async () => {
    const { service, adapter } = makeService();
    await service.update(4, { priority: 9 });
    expect(adapter.forget).not.toHaveBeenCalled();
  });

  it('persists an assigned color without reopening the client connection', async () => {
    const { service, repo, adapter } = makeService();
    await service.update(4, { color: 'green' });

    expect(repo.update).toHaveBeenCalledWith(4, { color: 'green' });
    expect(adapter.forget).not.toHaveBeenCalled();
  });

  /**
   * A relative path would resolve against the server process's working directory at import time,
   * which is neither what the operator typed nor anywhere they can predict.
   */
  it('refuses a path mapping that is not absolute on both sides', async () => {
    const { service } = makeService();
    await expect(service.create({ ...createDto, pathMappings: [{ remotePath: 'downloads', localPath: '/data/downloads' }] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.create({ ...createDto, pathMappings: [{ remotePath: '/downloads', localPath: 'data' }] })).rejects.toThrow(
      BadRequestException,
    );
  });

  /**
   * Rejecting after the insert leaves a client the operator cannot save over, because the second
   * attempt collides with the name the first one took.
   */
  it('writes nothing at all when a path mapping is rejected', async () => {
    const { service, repo } = makeService();

    await expect(service.create({ ...createDto, pathMappings: [{ remotePath: 'downloads', localPath: '/data/downloads' }] })).rejects.toThrow(
      BadRequestException,
    );

    expect(repo.createWithPathMappings).not.toHaveBeenCalled();
  });

  it('leaves an existing client untouched when its edit carries a bad mapping', async () => {
    const { service, repo } = makeService();

    await expect(service.update(4, { priority: 3, pathMappings: [{ remotePath: '/downloads', localPath: 'relative' }] })).rejects.toThrow(
      BadRequestException,
    );

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.replacePathMappings).not.toHaveBeenCalled();
  });

  it('accepts a Windows client path against a POSIX local one', async () => {
    const { service, repo } = makeService();
    const remotePath = ['D:', 'downloads'].join('\\');
    await service.create({ ...createDto, pathMappings: [{ remotePath, localPath: '/data/downloads' }] });
    expect(repo.createWithPathMappings).toHaveBeenCalledWith(expect.anything(), [{ remotePath, localPath: '/data/downloads' }]);
  });

  it('encrypts a password on the way in', async () => {
    const { service, credentials, repo } = makeService();
    await service.create({ ...createDto, password: 'hunter2' });

    expect(credentials.encrypt).toHaveBeenCalledWith('hunter2');
    expect(repo.createWithPathMappings).toHaveBeenCalledWith(expect.objectContaining({ credentialsEnc: 'cipher' }), expect.anything());
  });

  it('lets the credential service refuse a save when no encryption key is set', async () => {
    const { service } = makeService({
      credentials: {
        encrypt: vi.fn().mockImplementation(() => {
          throw new BadRequestException('Set BOOK_REQUEST_ENCRYPTION_KEY');
        }),
      },
    });

    await expect(service.create({ ...createDto, password: 'hunter2' })).rejects.toThrow(BadRequestException);
  });

  it('keeps the stored password when the update omits one', async () => {
    const { service, repo } = makeService();
    await service.update(4, { name: 'renamed' });

    expect(repo.update).toHaveBeenCalledWith(4, { name: 'renamed' });
  });

  it('clears the password when the update sends an empty one', async () => {
    const { service, repo } = makeService();
    await service.update(4, { password: '' });

    expect(repo.update).toHaveBeenCalledWith(4, { credentialsEnc: null });
  });

  /** Indexer URLs are user-supplied; a client on the LAN has to be opted in per row. */
  it('refuses a private base URL unless the row opts in, and says how to fix it', async () => {
    const { service } = makeService();
    await expect(service.create({ ...createDto, baseUrl: 'http://127.0.0.1:8080', allowPrivateAddress: false })).rejects.toThrow(
      /Allow private addresses/,
    );
  });

  it('accepts a private base URL once the row opts in', async () => {
    const { service, repo } = makeService();
    await service.create({ ...createDto, baseUrl: 'http://127.0.0.1:8080', allowPrivateAddress: true });
    expect(repo.createWithPathMappings).toHaveBeenCalled();
  });

  it('reports a duplicate name as a conflict', async () => {
    const { service } = makeService({
      repo: {
        createWithPathMappings: vi.fn().mockRejectedValue(new Error('Failed query', { cause: Object.assign(new Error('dup'), { code: '23505' }) })),
      },
    });
    await expect(service.create(createDto)).rejects.toThrow(ConflictException);
  });

  it('drops blank and duplicate path mappings rather than failing the whole save', async () => {
    const { service, repo } = makeService();
    await service.create({
      ...createDto,
      pathMappings: [
        { remotePath: ' /downloads ', localPath: ' /data/torrents ' },
        { remotePath: '/downloads', localPath: '/data/other' },
        { remotePath: '', localPath: '/data/nothing' },
      ],
    });

    expect(repo.createWithPathMappings).toHaveBeenCalledWith(expect.anything(), [{ remotePath: '/downloads', localPath: '/data/torrents' }]);
  });

  /** Rows that predate the rule are edited, not blocked; the grab is what refuses them. */
  it('leaves existing mappings alone when the update does not mention them', async () => {
    const { service, repo } = makeService();
    await service.update(4, { name: 'renamed' });
    expect(repo.replacePathMappings).not.toHaveBeenCalled();
  });

  it('refuses a client with no path mapping, so nothing it downloads is imported from an undeclared root', async () => {
    const { service } = makeService();
    await expect(service.create({ ...createDto, pathMappings: [] })).rejects.toThrow(BadRequestException);
    await expect(service.update(4, { pathMappings: [] })).rejects.toThrow(BadRequestException);
  });

  /** The single-host install: same filesystem is an identity mapping, not an absent one. */
  it('accepts an identity mapping', async () => {
    const { service, repo } = makeService();
    await service.create({ ...createDto, pathMappings: [{ remotePath: '/downloads', localPath: '/downloads' }] });
    expect(repo.createWithPathMappings).toHaveBeenCalledWith(expect.anything(), [{ remotePath: '/downloads', localPath: '/downloads' }]);
  });

  it('stamps the row with the outcome of a connection test', async () => {
    const { service, repo } = makeService();
    await expect(service.test(4)).resolves.toEqual({ success: true, version: 'v5.0.3' });
    expect(repo.recordTestResult).toHaveBeenCalledWith(4, true, null);
  });

  it('records why a connection test failed, and reports it as a failure rather than a 200', async () => {
    const { service, repo, registry } = makeService();
    registry.require.mockReturnValue({ test: vi.fn().mockResolvedValue({ success: false, error: 'refused' }) });

    await expect(service.test(4)).rejects.toMatchObject({ status: HttpStatus.BAD_GATEWAY, response: { message: 'refused' } });
    expect(repo.recordTestResult).toHaveBeenCalledWith(4, false, 'refused');
  });

  it('answers a passing test normally', async () => {
    const { service, repo, registry } = makeService();
    registry.require.mockReturnValue({ test: vi.fn().mockResolvedValue({ success: true }) });

    await expect(service.test(4)).resolves.toEqual({ success: true });
    expect(repo.recordTestResult).toHaveBeenCalledWith(4, true, null);
  });

  it('decrypts credentials only into a value object, never onto the row', async () => {
    const { service, credentials } = makeService();
    const resolved = await service.resolveConfig(4);

    expect(credentials.decrypt).toHaveBeenCalledWith('cipher');
    expect(resolved).toMatchObject({ id: 4, password: 'secret', allowPrivateAddress: false });
  });

  it('404s an unknown client', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(undefined) } });
    await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
  });

  describe('testHardlink', () => {
    const withMapping = {
      findById: vi.fn().mockResolvedValue({
        client: clientRow(),
        pathMappings: [{ id: 7, downloadClientId: 4, remotePath: '/downloads', localPath: '/data/torrents' }],
      }),
    };

    it('probes the directory the named mapping stored, never one the caller supplied', async () => {
      const { service, pathMappings } = makeService({ repo: withMapping });

      await service.testHardlink(4, 7);

      expect(pathMappings.testHardlink).toHaveBeenCalledWith('/data/torrents', '/data/book-dock');
    });

    it('404s a mapping that belongs to another client, so the probe cannot be aimed anywhere else', async () => {
      const { service, pathMappings } = makeService({ repo: withMapping });

      await expect(service.testHardlink(4, 8)).rejects.toThrow(NotFoundException);
      expect(pathMappings.testHardlink).not.toHaveBeenCalled();
    });
  });

  /**
   * The attempt's FK nulls on delete, so a torrent whose client is removed keeps running while
   * nothing can poll it, map it to a local path or remove it again.
   */
  describe('remove', () => {
    it('refuses while the client is still working on downloads, and says how many', async () => {
      const { service, repo, downloads } = makeService({ downloads: { countInFlightForClient: vi.fn().mockResolvedValue(3) } });

      await expect(service.remove(4)).rejects.toThrow(/3 downloads/);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(downloads.countInFlightForClient).toHaveBeenCalledWith(4);
    });

    it('reads as a conflict rather than a bad request, so the UI can offer to go and clear them', async () => {
      const { service } = makeService({ downloads: { countInFlightForClient: vi.fn().mockResolvedValue(1) } });

      await expect(service.remove(4)).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes a client with nothing in flight, dropping its cached session with it', async () => {
      const { service, repo, adapter } = makeService();

      await service.remove(4);

      expect(repo.delete).toHaveBeenCalledWith(4);
      expect(adapter.forget).toHaveBeenCalledWith(4);
    });
  });
});
