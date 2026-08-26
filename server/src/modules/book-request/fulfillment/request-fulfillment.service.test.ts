import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NotificationType, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, WORKER_WRITABLE_BOOK_REQUEST_STATUSES } from '@bookorbit/types';

import type { RequestUser } from '../../../common/types/request-user';
import type { BookRequestDownloadRow, BookRequestRow } from '../../../db/schema';
import { IndexerSearchException } from '../indexers/indexer-adapter';
import { RequestFulfillmentService } from './request-fulfillment.service';

const INFO_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';
const MAGNET = `magnet:?xt=urn:btih:${INFO_HASH}&dn=Dune`;

function bencodeString(value: string): Buffer {
  return Buffer.from(`${Buffer.byteLength(value)}:${value}`, 'utf8');
}

function torrentBytes(name = 'dune.epub'): Buffer {
  return Buffer.concat([Buffer.from('d4:infod4:name'), bencodeString(name), Buffer.from('ee')]);
}

function multiFileTorrent(names: string[]): Buffer {
  const files = names.map((name) => Buffer.concat([Buffer.from('d6:lengthi1e4:pathl'), bencodeString(name), Buffer.from('ee')]));
  return Buffer.concat([Buffer.from('d4:infod5:filesl'), ...files, Buffer.from('e4:name7:releaseee')]);
}

function user(): RequestUser {
  return { id: 1, name: 'Ann', isSuperuser: false, permissions: [] } as unknown as RequestUser;
}

function joined(overrides: Partial<BookRequestRow> = {}) {
  return {
    request: {
      id: 7,
      userId: 3,
      title: 'Dune',
      status: 'approved',
      targetLibraryId: 2,
      createdAt: new Date('2026-08-18T00:00:00Z'),
      updatedAt: new Date('2026-08-18T00:00:00Z'),
      ...overrides,
    } as BookRequestRow,
    requesterUsername: 'bob',
    requesterName: 'Bob',
    decidedByUsername: null,
    targetLibraryName: 'Books',
  };
}

function makeService(
  overrides: {
    requests?: Record<string, unknown>;
    downloads?: Record<string, unknown>;
    clients?: Record<string, unknown>;
    indexers?: Record<string, unknown>;
    releases?: Record<string, unknown>;
    indexerAdapter?: Record<string, unknown>;
  } = {},
) {
  const requests = {
    findById: vi.fn().mockResolvedValue(joined()),
    claimForGrab: vi.fn().mockResolvedValue('claimed'),
    update: vi.fn().mockResolvedValue(undefined),
    updateIf: vi.fn().mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => Promise.resolve({ id, ...patch })),
    findSubscribers: vi.fn().mockResolvedValue(new Map()),
    findDismissedRequestIds: vi.fn().mockResolvedValue(new Set()),
    clearDismissals: vi.fn().mockResolvedValue(undefined),
    findInterestedUserIds: vi.fn().mockResolvedValue([3]),
    ...overrides.requests,
  };
  const downloads = {
    create: vi.fn().mockImplementation((data: Record<string, unknown>) => Promise.resolve({ id: 11, ...data } as BookRequestDownloadRow)),
    update: vi.fn().mockResolvedValue(undefined),
    updateIf: vi.fn().mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => Promise.resolve({ id, ...patch })),
    findLatestForRequests: vi.fn().mockResolvedValue(new Map()),
    ...overrides.downloads,
  };
  const clients = {
    findOne: vi.fn().mockResolvedValue({ id: 4, name: 'qbit', adapterType: 'qbittorrent', enabled: true, pathMappings: [{ id: 1 }] }),
    findPreferredEnabled: vi.fn().mockResolvedValue({ id: 4 }),
    resolveConfig: vi.fn().mockResolvedValue({ id: 4, adapterType: 'qbittorrent' }),
    ...overrides.clients,
  };
  const adapter = { add: vi.fn().mockResolvedValue({ clientHash: INFO_HASH }) };
  const registry = { require: vi.fn().mockReturnValue(adapter) };
  const direct = { add: vi.fn().mockResolvedValue({ clientHash: INFO_HASH }) };
  const indexers = {
    resolveConfig: vi.fn().mockResolvedValue({ id: 9, name: 'tracker', adapterType: 'torznab' }),
    ...overrides.indexers,
  };
  const indexerAdapter = { fetchTorrentFile: vi.fn(), ...overrides.indexerAdapter };
  const indexerRegistry = { require: vi.fn().mockReturnValue(indexerAdapter) };
  const releases = { find: vi.fn().mockReturnValue(undefined), search: vi.fn(), forget: vi.fn(), ...overrides.releases };
  const notifier = {
    notifyApprovers: vi.fn().mockResolvedValue(undefined),
    notifyInterested: vi.fn().mockResolvedValue(undefined),
    notifyResponsible: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = { emitChanged: vi.fn(), emitProgress: vi.fn() };
  const events = { emit: vi.fn() };

  const service = new RequestFulfillmentService(
    requests as never,
    downloads as never,
    clients as never,
    registry as never,
    direct as never,
    indexers as never,
    indexerRegistry as never,
    releases as never,
    notifier as never,
    gateway as never,
    events as never,
  );

  return {
    service,
    requests,
    downloads,
    clients,
    adapter,
    direct,
    registry,
    indexers,
    indexerAdapter,
    indexerRegistry,
    releases,
    notifier,
    gateway,
    events,
  };
}

describe('RequestFulfillmentService.grab', () => {
  it('records the attempt before calling the client, so an add never outlives its row', async () => {
    const { service, downloads, adapter } = makeService();

    await service.grab(7, { magnet: MAGNET }, user());

    expect(downloads.create).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 7, source: 'magnet', clientHash: INFO_HASH, status: 'queued', releaseTitle: 'Dune' }),
    );
    expect(downloads.create.mock.invocationCallOrder[0]).toBeLessThan(adapter.add.mock.invocationCallOrder[0]);
  });

  it('marks who grabbed it, because only an unattended attempt may be retried unattended', async () => {
    const { service, downloads } = makeService();

    await service.grab(7, { magnet: MAGNET }, user());
    expect(downloads.create).toHaveBeenCalledWith(expect.objectContaining({ automated: false }));

    await service.grab(7, { magnet: MAGNET }, null);
    expect(downloads.create).toHaveBeenLastCalledWith(expect.objectContaining({ automated: true }));
  });

  /**
   * The infohash is derived from the trimmed link, so the client has to be handed the same one.
   * qBittorrent splits its `urls` field on newlines, and a pasted trailing one is invisible.
   */
  it('hands the client the trimmed magnet the hash was derived from', async () => {
    const { service, adapter } = makeService();
    await service.grab(7, { magnet: `  ${MAGNET}\n` }, user());
    expect(adapter.add).toHaveBeenCalledWith(expect.objectContaining({ magnet: MAGNET, infoHash: INFO_HASH }), expect.anything());
  });

  /** The size of what the release carries; a magnet does not state one, so it stays null. */
  it('records no release size for a magnet', async () => {
    const { service, downloads } = makeService();
    await service.grab(7, { magnet: MAGNET }, user());
    expect(downloads.create).toHaveBeenCalledWith(expect.objectContaining({ releaseSizeBytes: null }));
  });

  it('moves the request to grabbed once the client has it', async () => {
    const { service, requests } = makeService();
    await service.grab(7, { magnet: MAGNET }, user());
    expect(requests.updateIf).toHaveBeenCalledWith(7, ['grabbed'], { status: 'grabbed', statusReason: null });
  });

  /** Someone who hid the failure still wants the book, so the retry puts it back on their list. */
  it('un-hides a request that someone had dismissed as failed', async () => {
    const { service, requests } = makeService();
    await service.grab(7, { magnet: MAGNET }, user());
    expect(requests.clearDismissals).toHaveBeenCalledWith(7);
  });

  it('fails the attempt but not the request when the client rejects the add', async () => {
    const { service, downloads, registry, requests } = makeService();
    registry.require.mockReturnValue({ add: vi.fn().mockRejectedValue(new BadRequestException('qBittorrent rejected the torrent')) });

    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(BadRequestException);

    expect(downloads.update).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'failed' }));
    // The grab claimed the request before calling out, so the request does get written: back to
    // exactly where it started, which is what keeps the picker offering another release. Only if
    // the claim is still ours, so a cancellation that landed mid-grab is not rolled back over.
    expect(requests.updateIf).toHaveBeenCalledWith(7, ['grabbed'], { status: 'approved' });
    expect(requests.updateIf).not.toHaveBeenCalledWith(7, expect.anything(), expect.objectContaining({ status: 'failed' }));
  });

  /** Two approvers on one request: whoever loses the claim is told, not silently ignored. */
  it('refuses a second concurrent grab rather than starting two releases for one request', async () => {
    const { service, downloads, requests } = makeService();
    requests.claimForGrab.mockResolvedValue('moved');

    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(ConflictException);
    expect(downloads.create).not.toHaveBeenCalled();
  });

  /**
   * The documented retry path: the work was requested again while this one sat at `failed`, so the
   * new request holds the dedupe claim and re-grabbing the old one collides with it. A coded 409,
   * not the raw Postgres violation the approver used to get as a 500.
   */
  it('refuses a re-grab whose work another live request has taken over', async () => {
    const { service, downloads, requests } = makeService();
    requests.claimForGrab.mockResolvedValue('duplicate');

    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(/already requested this book again/);
    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(ConflictException);
    expect(downloads.create).not.toHaveBeenCalled();
  });

  it('reads the infohash and name out of a .torrent upload', async () => {
    const { service, downloads } = makeService();
    // d4:infod4:name8:dune.epubee - a minimal bencoded dictionary with a name.
    const torrent = Buffer.from('d4:infod4:name9:dune.epubee').toString('base64');

    await service.grab(7, { torrentFileBase64: torrent, torrentFileName: 'upload.torrent' }, user());

    expect(downloads.create).toHaveBeenCalledWith(expect.objectContaining({ source: 'torrent_file', releaseTitle: 'dune.epub' }));
  });

  it('refuses both a magnet and a file at once', async () => {
    const { service } = makeService();
    await expect(service.grab(7, { magnet: MAGNET, torrentFileBase64: 'ZA==' }, user())).rejects.toThrow(BadRequestException);
  });

  it('refuses neither', async () => {
    const { service } = makeService();
    await expect(service.grab(7, {}, user())).rejects.toThrow(BadRequestException);
  });

  /**
   * Finalize resolves its destination from the request row. Without a library the download would
   * run to completion and then stop at "missing destination".
   */
  it('refuses a request with no destination library before anything is downloaded', async () => {
    const { service, adapter } = makeService({ requests: { findById: vi.fn().mockResolvedValue(joined({ targetLibraryId: null })) } });

    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(BadRequestException);
    expect(adapter.add).not.toHaveBeenCalled();
  });

  it('refuses to grab a request that is still pending approval', async () => {
    const { service } = makeService({ requests: { findById: vi.fn().mockResolvedValue(joined({ status: 'pending' })) } });
    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(BadRequestException);
  });

  it('allows a re-grab after a failed attempt', async () => {
    const { service, adapter } = makeService({ requests: { findById: vi.fn().mockResolvedValue(joined({ status: 'failed' })) } });
    await service.grab(7, { magnet: MAGNET }, user());
    expect(adapter.add).toHaveBeenCalled();
  });

  it('reports a duplicate infohash as a conflict rather than a 500', async () => {
    const { service } = makeService({
      downloads: { create: vi.fn().mockRejectedValue(new Error('Failed query', { cause: Object.assign(new Error('dup'), { code: '23505' }) })) },
    });
    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(ConflictException);
  });

  it('explains that no download client is configured', async () => {
    const { service } = makeService({ clients: { findPreferredEnabled: vi.fn().mockResolvedValue(undefined) } });
    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(BadRequestException);
  });

  it('refuses a client the operator has disabled', async () => {
    const { service } = makeService({ clients: { findOne: vi.fn().mockResolvedValue({ id: 4, name: 'qbit', enabled: false }) } });
    await expect(service.grab(7, { downloadClientId: 4, magnet: MAGNET }, user())).rejects.toThrow(BadRequestException);
  });

  /**
   * A client with no mapping declares no directory the import may read out of, so the attempt
   * would seed for hours and then be refused. Rows predating that rule are what reaches this.
   */
  it('refuses a client with no path mapping rather than downloading something it cannot import', async () => {
    const { service, downloads } = makeService({
      clients: { findOne: vi.fn().mockResolvedValue({ id: 4, name: 'qbit', adapterType: 'qbittorrent', enabled: true, pathMappings: [] }) },
    });

    await expect(service.grab(7, { downloadClientId: 4, magnet: MAGNET }, user())).rejects.toThrow(BadRequestException);
    expect(downloads.create).not.toHaveBeenCalled();
  });

  it('404s an unknown request', async () => {
    const { service } = makeService({ requests: { findById: vi.fn().mockResolvedValue(undefined) } });
    await expect(service.grab(7, { magnet: MAGNET }, user())).rejects.toThrow(NotFoundException);
  });
});

describe('RequestFulfillmentService.grab from a picked release', () => {
  const RELEASE = {
    indexerId: 9,
    guid: 'r-1',
    title: 'Dune - Frank Herbert [EPUB]',
    downloadUrl: 'https://tracker.example.com/download?tid=1',
    sizeBytes: 2_000_000,
    seeders: 31,
    leechers: 2,
    format: 'epub',
    freeleech: true,
    /** Stated by the tracker itself, which is the only source of either goal now. */
    seedRatioGoal: 2,
    seedTimeMinutes: 4320,
  };

  it('resolves the release server-side and snapshots what the indexer said about it', async () => {
    const { service, downloads, indexerAdapter } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(torrentBytes()) },
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());

    expect(indexerAdapter.fetchTorrentFile).toHaveBeenCalled();
    expect(downloads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        indexerId: 9,
        releaseGuid: 'r-1',
        releaseTitle: 'Dune - Frank Herbert [EPUB]',
        releaseSeeders: 31,
        releaseFormat: 'epub',
        freeleech: true,
        source: 'torrent_file',
      }),
    );
  });

  it('inspects the torrent without creating an attempt and reuses it for the following grab', async () => {
    const { service, downloads, adapter, indexerAdapter } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(torrentBytes()) },
    });

    await expect(service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' })).resolves.toMatchObject({
      source: 'torrent_file',
      status: 'ready',
      totalFiles: 1,
      primaryFileCount: 1,
      files: [{ path: 'dune.epub', bookFile: true }],
    });
    expect(downloads.create).not.toHaveBeenCalled();
    expect(adapter.add).not.toHaveBeenCalled();

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());
    expect(indexerAdapter.fetchTorrentFile).toHaveBeenCalledTimes(1);
  });

  /**
   * RAR and ZIP packaging is ordinary on private trackers. The layout is genuinely unknowable
   * until the archive is open, so it is reported as unknown and judged after the download rather
   * than refused on a guess.
   */
  it('sends an archived release and reports its contents as unknown until it is extracted', async () => {
    const { service, downloads, adapter } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(torrentBytes('wrapped.zip')) },
    });

    await expect(service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' })).resolves.toMatchObject({
      status: 'contents_unknown',
      unitCount: 0,
      containerCount: 1,
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());
    expect(downloads.create).toHaveBeenCalled();
    expect(adapter.add).toHaveBeenCalled();
  });

  /**
   * The bytes are the expensive part. A release holding several books is sent and the question is
   * asked once it has landed, rather than refused on a guess and downloaded again later.
   */
  it('sends a release holding several books and says how many it holds', async () => {
    const { service, downloads, adapter } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(multiFileTorrent(['one.epub', 'two.epub', 'cover.jpg'])) },
    });

    await expect(service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' })).resolves.toMatchObject({
      status: 'multiple_supported_files',
      unitCount: 2,
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());
    expect(downloads.create).toHaveBeenCalled();
    expect(adapter.add).toHaveBeenCalled();
  });

  /** One book in several parts is a clean import now, so the picker must not call it a problem. */
  it('reports a multipart audiobook as ready rather than as many book files', async () => {
    const { service } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(multiFileTorrent(['Chapter 1.mp3', 'Chapter 2.mp3', 'cover.jpg'])) },
    });

    await expect(service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' })).resolves.toMatchObject({
      status: 'ready',
      unitCount: 1,
      units: [expect.objectContaining({ mediaKind: 'audiobook', contentFileCount: 2 })],
    });
  });

  it('bounds the manifest response even when every listed file is supported', async () => {
    const names = Array.from({ length: 201 }, (_, index) => `book-${index}.epub`);
    const { service } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(multiFileTorrent(names)) },
    });

    const inspection = await service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' });
    expect(inspection).toMatchObject({
      status: 'multiple_supported_files',
      totalFiles: 201,
      primaryFileCount: 201,
      truncated: true,
    });
    expect(inspection.files).toHaveLength(200);
  });

  it('explains that a magnet needs swarm metadata before its files are knowable', async () => {
    const { service, indexerAdapter } = makeService({ releases: { find: vi.fn().mockReturnValue({ ...RELEASE, magnet: MAGNET }) } });

    await expect(service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' })).resolves.toEqual({
      source: 'magnet',
      status: 'metadata_unavailable',
      files: [],
      totalFiles: null,
      primaryFileCount: null,
      truncated: false,
      units: [],
      unitCount: 0,
      ignoredFileCount: 0,
      containerCount: 0,
    });
    expect(indexerAdapter.fetchTorrentFile).not.toHaveBeenCalled();
  });

  it('refuses qBittorrent for a direct-file release before recording an attempt', async () => {
    const directRelease = { ...RELEASE, downloadUrl: 'https://www.gutenberg.org/ebooks/2868.epub', format: 'epub' };
    const { service, downloads } = makeService({
      clients: {
        findOne: vi.fn().mockResolvedValue({ id: 4, name: 'qBittorrent', adapterType: 'qbittorrent', enabled: true, pathMappings: [{ id: 1 }] }),
      },
      indexers: {
        resolveConfig: vi.fn().mockResolvedValue({
          id: 9,
          name: 'Project Gutenberg',
          adapterType: 'project-gutenberg',
          seedRatioGoal: null,
        }),
      },
      releases: { find: vi.fn().mockReturnValue(directRelease) },
      indexerAdapter: {
        resolveFile: vi.fn().mockResolvedValue({
          url: directRelease.downloadUrl,
          fileName: '2868.epub',
          sizeBytes: 1234,
          format: 'epub',
        }),
      },
    });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'r-1', downloadClientId: 4 }, user())).rejects.toMatchObject({
      status: 400,
      message: 'Download client "qBittorrent" cannot fetch a direct file',
    });
    expect(downloads.create).not.toHaveBeenCalled();
  });

  it('routes a direct-file release to the built-in downloader when no client is named', async () => {
    const directRelease = { ...RELEASE, downloadUrl: 'https://www.gutenberg.org/ebooks/2868.epub', format: 'epub' };
    const { service, clients, downloads, direct, adapter } = makeService({
      indexers: {
        resolveConfig: vi.fn().mockResolvedValue({
          id: 9,
          name: 'Project Gutenberg',
          adapterType: 'project-gutenberg',
          seedRatioGoal: null,
        }),
      },
      releases: { find: vi.fn().mockReturnValue(directRelease) },
      indexerAdapter: {
        resolveFile: vi.fn().mockResolvedValue({
          url: directRelease.downloadUrl,
          fileName: '2868.epub',
          sizeBytes: 1234,
          format: 'epub',
        }),
      },
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());

    // No client is resolved at all: there is no row for the built-in downloader to be found in.
    expect(clients.findPreferredEnabled).not.toHaveBeenCalled();
    expect(downloads.create).toHaveBeenCalledWith(expect.objectContaining({ downloadClientId: null, source: 'direct_url' }));
    expect(direct.add).toHaveBeenCalledWith(expect.objectContaining({ fileUrl: directRelease.downloadUrl, fileName: '2868.epub' }));
    expect(adapter.add).not.toHaveBeenCalled();
  });

  /**
   * A direct source states its format out of band, and its URL often ends in something that is not
   * a filename at all. Staging that answer unchanged is how a release was reported ready, fetched
   * in full, and only then refused by an importer that classifies by extension alone.
   */
  it('stages a nameless direct file under its declared format, and reports it ready', async () => {
    const directRelease = { ...RELEASE, downloadUrl: 'https://archive.org/download/frankenstein/get', format: 'epub' };
    const { service, direct } = makeService({
      indexers: {
        resolveConfig: vi.fn().mockResolvedValue({ id: 9, name: 'Internet Archive', adapterType: 'internet-archive', seedRatioGoal: null }),
      },
      releases: { find: vi.fn().mockReturnValue(directRelease) },
      indexerAdapter: {
        resolveFile: vi.fn().mockResolvedValue({ url: directRelease.downloadUrl, fileName: 'download', sizeBytes: 1234, format: 'epub' }),
      },
    });

    expect(await service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' })).toMatchObject({
      status: 'ready',
      primaryFileCount: 1,
      files: [expect.objectContaining({ path: 'download.epub', bookFile: true })],
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());
    expect(direct.add).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'download.epub', format: 'epub' }));
  });

  /** Refused at inspection, which is before the fetch, rather than after downloading the whole file. */
  it('refuses a direct file whose declared format nothing can import', async () => {
    const directRelease = { ...RELEASE, downloadUrl: 'https://example.com/read/frankenstein', format: 'html' };
    const { service, downloads, direct } = makeService({
      indexers: { resolveConfig: vi.fn().mockResolvedValue({ id: 9, name: 'Somewhere', adapterType: 'torznab', seedRatioGoal: null }) },
      releases: { find: vi.fn().mockReturnValue(directRelease) },
      indexerAdapter: {
        resolveFile: vi.fn().mockResolvedValue({ url: directRelease.downloadUrl, fileName: 'download', sizeBytes: 1234, format: 'html' }),
      },
    });

    expect(await service.inspectRelease(7, { indexerId: 9, releaseGuid: 'r-1' })).toMatchObject({ status: 'no_supported_file' });

    // Recorded as a refused attempt the way any other unimportable release is, and never fetched.
    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user())).rejects.toMatchObject({ status: 400 });
    expect(direct.add).not.toHaveBeenCalled();
    expect(downloads.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', clientHash: null }));
  });

  /** A `.zip` holding an epub is an archive the importer extracts, and `book.zip.epub` is not. */
  it('leaves a direct file that already carries an extension alone', async () => {
    const directRelease = { ...RELEASE, downloadUrl: 'https://example.com/frankenstein.zip', format: 'epub' };
    const { service, direct } = makeService({
      indexers: { resolveConfig: vi.fn().mockResolvedValue({ id: 9, name: 'Somewhere', adapterType: 'torznab', seedRatioGoal: null }) },
      releases: { find: vi.fn().mockReturnValue(directRelease) },
      indexerAdapter: {
        resolveFile: vi.fn().mockResolvedValue({ url: directRelease.downloadUrl, fileName: 'frankenstein.zip', sizeBytes: 1234, format: 'epub' }),
      },
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());

    expect(direct.add).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'frankenstein.zip' }));
  });

  /** The tracker states both goals and the client enforces them; BookOrbit never stops a seed. */
  it("passes the release's own seed goals to the download client at add time", async () => {
    const { service, adapter } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(torrentBytes()) },
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());

    expect(adapter.add).toHaveBeenCalledWith(expect.objectContaining({ seedRatioGoal: 2, seedTimeMinutes: 4320 }), expect.anything());
  });

  /** Torznab states no format, so what the approver saw came off the release name. Record that. */
  it('snapshots the format the picker showed rather than the empty field the indexer sent', async () => {
    const { service, downloads } = makeService({
      releases: { find: vi.fn().mockReturnValue({ ...RELEASE, format: undefined }) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockResolvedValue(torrentBytes()) },
    });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());

    expect(downloads.create).toHaveBeenCalledWith(expect.objectContaining({ releaseFormat: 'epub' }));
  });

  it('uses the magnet directly when the indexer published one, without fetching a .torrent', async () => {
    const { service, downloads, indexerAdapter } = makeService({ releases: { find: vi.fn().mockReturnValue({ ...RELEASE, magnet: MAGNET }) } });

    await service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user());

    expect(indexerAdapter.fetchTorrentFile).not.toHaveBeenCalled();
    expect(downloads.create).toHaveBeenCalledWith(expect.objectContaining({ source: 'magnet', clientHash: INFO_HASH }));
  });

  /**
   * The tracker refuses individual releases for reasons only it knows ("VIP torrent and you are
   * not VIP or higher"). Rethrown as-is that reaches the approver as a 500 with no reason at all,
   * when the reason is the one thing that tells them to pick a different release.
   */
  it('reports a tracker refusing the release as a bad request carrying the reason the tracker gave', async () => {
    const { service, adapter, direct } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: {
        fetchTorrentFile: vi.fn().mockRejectedValue(new IndexerSearchException('error', 'tracker answered 406: Download blocked: VIP torrent')),
      },
    });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user())).rejects.toMatchObject({
      status: 400,
      message: 'tracker answered 406: Download blocked: VIP torrent',
      response: { errorCode: 'GRAB_SOURCE_REFUSED' },
    });
    // Nothing was handed anywhere; the row that is written is the record of having asked.
    expect(adapter.add).not.toHaveBeenCalled();
    expect(direct.add).not.toHaveBeenCalled();
  });

  /**
   * A request that ends up downloading from its second source looks unremarkable on its own row.
   * The first source having been asked and having refused is only visible if it was recorded.
   */
  it('keeps a refused release as an attempt of its own, with the reason on it', async () => {
    const { service, downloads } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: {
        fetchTorrentFile: vi.fn().mockRejectedValue(new IndexerSearchException('error', 'tracker answered 406: Download blocked: VIP torrent')),
      },
    });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user())).rejects.toMatchObject({ status: 400 });

    expect(downloads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 7,
        indexerId: 9,
        status: 'failed',
        // No client took it and no hash exists, which is what tells a refusal from a failed download.
        downloadClientId: null,
        clientHash: null,
        releaseGuid: 'r-1',
        errorMessage: 'tracker answered 406: Download blocked: VIP torrent',
      }),
    );
  });

  /** A hand-pasted magnet came from no source, so there is nothing to attribute a refusal to. */
  it('records nothing for a refusal that was not about a release in the list', async () => {
    const { service, downloads } = makeService({ releases: { find: vi.fn().mockReturnValue(undefined) } });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'gone' }, user())).rejects.toThrow(BadRequestException);

    expect(downloads.create).not.toHaveBeenCalled();
  });

  /**
   * The same refusal on a release the tracker itself flagged as VIP-only is about the VIP
   * releases, not about the tracker: an automatic fallback that skipped the whole source over it
   * would throw away every ordinary release the tracker holds.
   */
  it('marks a refused VIP-only release as a VIP restriction rather than a refused source', async () => {
    const { service } = makeService({
      releases: { find: vi.fn().mockReturnValue({ ...RELEASE, vipOnly: true }) },
      indexerAdapter: {
        fetchTorrentFile: vi.fn().mockRejectedValue(new IndexerSearchException('error', 'tracker answered 406: VIP torrent')),
      },
    });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user())).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'GRAB_VIP_REQUIRED' },
    });
  });

  /** A tracker that was merely slow says nothing about the release, so it is worth another go. */
  it('reports an unreachable tracker as unavailable rather than as a refused release', async () => {
    const { service } = makeService({
      releases: { find: vi.fn().mockReturnValue(RELEASE) },
      indexerAdapter: { fetchTorrentFile: vi.fn().mockRejectedValue(new IndexerSearchException('timeout', 'tracker did not answer in time')) },
    });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'r-1' }, user())).rejects.toMatchObject({
      status: 503,
      response: { errorCode: 'GRAB_SOURCE_UNAVAILABLE' },
    });
  });

  it('says the release list has expired rather than grabbing something else', async () => {
    const { service, downloads } = makeService({ releases: { find: vi.fn().mockReturnValue(undefined) } });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'gone' }, user())).rejects.toThrow(BadRequestException);
    expect(downloads.create).not.toHaveBeenCalled();
  });

  it('refuses a picked release alongside a hand-pasted magnet', async () => {
    const { service } = makeService({ releases: { find: vi.fn().mockReturnValue(RELEASE) } });

    await expect(service.grab(7, { indexerId: 9, releaseGuid: 'r-1', magnet: MAGNET }, user())).rejects.toThrow(BadRequestException);
  });
});

describe('RequestFulfillmentService.listReleases', () => {
  it('does not spend a tracker hit on a request that was refused', async () => {
    const { service, releases } = makeService({ requests: { findById: vi.fn().mockResolvedValue(joined({ status: 'rejected' })) } });

    await expect(service.listReleases(7)).rejects.toThrow(BadRequestException);
    expect(releases.search).not.toHaveBeenCalled();
  });

  it('404s an unknown request', async () => {
    const { service } = makeService({ requests: { findById: vi.fn().mockResolvedValue(undefined) } });

    await expect(service.listReleases(7)).rejects.toThrow(NotFoundException);
  });

  it('normalizes manual search fields and canonicalizes the selected ISBNs', async () => {
    const { service, releases } = makeService();

    await service.listReleases(7, {
      refresh: true,
      overrides: {
        title: '  Dune Messiah  ',
        authors: [' Frank Herbert ', 'Frank Herbert', ''],
        isbn: '0593098234',
        language: 'English',
        preferredFormats: [' EPUB ', 'epub', 'AZW3'],
      },
    });

    expect(releases.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refresh: true,
        overrides: {
          title: 'Dune Messiah',
          authors: ['Frank Herbert'],
          isbn: '9780593098233',
          language: 'en',
          preferredFormats: ['epub', 'azw3'],
        },
      }),
    );
  });

  it('rejects an invalid manual ISBN instead of silently dropping it', async () => {
    const { service, releases } = makeService();

    await expect(service.listReleases(7, { overrides: { isbn: 'not-an-isbn' } })).rejects.toThrow(BadRequestException);
    expect(releases.search).not.toHaveBeenCalled();
  });
});

describe('RequestFulfillmentService.failDownload', () => {
  it('fails the attempt, the request and tells the approvers, all in one place', async () => {
    const { service, downloads, requests, notifier } = makeService();

    await service.failDownload({ id: 11, requestId: 7 } as BookRequestDownloadRow, 'The download client no longer has this torrent');

    expect(downloads.updateIf).toHaveBeenCalledWith(11, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, {
      status: 'failed',
      errorMessage: 'The download client no longer has this torrent',
    });
    expect(requests.updateIf).toHaveBeenCalledWith(7, WORKER_WRITABLE_BOOK_REQUEST_STATUSES, {
      status: 'failed',
      statusReason: 'The download client no longer has this torrent',
    });
    expect(notifier.notifyResponsible).toHaveBeenCalledWith(
      { id: 7, selfServe: false },
      NotificationType.BookRequestFailed,
      expect.objectContaining({ meta: { requestId: 7, downloadId: 11 } }),
    );
  });

  it('announces the failure only once the request is marked and the approvers are told', async () => {
    const { service, requests, notifier, events } = makeService();

    events.emit.mockImplementation(() => {
      // Whatever listens here must see a settled failure, not a request still reading as active.
      expect(requests.updateIf).toHaveBeenCalledWith(7, expect.anything(), expect.objectContaining({ status: 'failed' }));
      expect(notifier.notifyResponsible).toHaveBeenCalled();
      return true;
    });

    await service.failDownload({ id: 11, requestId: 7 } as BookRequestDownloadRow, 'stalled');

    expect(events.emit).toHaveBeenCalledWith('book-request.download.failed', 11);
  });

  /**
   * Both callers are sweeps over rows read some time ago: the poll loop and the watchdog. A
   * request somebody cancelled or filed in the meantime must not be reopened as a failure, and
   * nobody should be told about a failure they are no longer waiting on.
   */
  it('leaves a request somebody already settled alone, and tells nobody', async () => {
    const { service, requests, notifier, events } = makeService();
    requests.updateIf.mockResolvedValue(undefined);

    await service.failDownload({ id: 11, requestId: 7 } as BookRequestDownloadRow, 'stalled');

    expect(notifier.notifyResponsible).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  /** An attempt that already settled keeps the reason it settled for, which is the useful one. */
  it('does not rewrite an attempt that settled between the read and the write', async () => {
    const { service, downloads, requests } = makeService();
    downloads.updateIf.mockResolvedValue(undefined);

    await service.failDownload({ id: 11, requestId: 7 } as BookRequestDownloadRow, 'stalled');

    expect(requests.updateIf).not.toHaveBeenCalled();
  });
});
