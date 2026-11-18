import { describe, expect, it, vi } from 'vitest';
import type { BookRequestAutomationSettings, DownloadClientItem, IndexerItem } from '@bookorbit/types';

import type { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import type { BookRequestService } from './book-request.service';
import { BookRequestSetupFlow } from './book-request.setup-flow';
import type { DownloadClientConfigService } from './download-clients/download-client-config.service';
import type { RequestAutomationSettingsService } from './fulfillment/request-automation-settings.service';
import type { IndexerConfigService } from './indexers/indexer-config.service';

const SETTINGS = {
  autoGrabEnabled: true,
  autoGrabMinScore: 80,
  autoRetryEnabled: true,
  maxAutoGrabAttempts: 3,
  autoSearchEnabled: true,
  autoSearchIntervalHours: 24,
  autoSearchMaxAgeDays: 60,
  verificationEnabled: true,
  verificationThreshold: 70,
  importFormats: 'preferred',
} as BookRequestAutomationSettings;

function source(over: Partial<IndexerItem> = {}): IndexerItem {
  return {
    id: 1,
    name: 'Prowlarr',
    adapterType: 'torznab',
    enabled: true,
    disabledMediaKinds: [],
    lastTestOk: true,
    lastSearchOk: true,
    searchFailureStreak: 0,
    ...over,
  } as IndexerItem;
}

function client(over: Partial<DownloadClientItem> = {}): DownloadClientItem {
  return {
    id: 1,
    name: 'qBittorrent',
    adapterType: 'qbittorrent',
    enabled: true,
    useHardlinks: true,
    lastTestOk: true,
    ...over,
  } as DownloadClientItem;
}

function build(
  options: {
    sources?: IndexerItem[];
    clients?: DownloadClientItem[];
    settings?: Partial<BookRequestAutomationSettings>;
    destinations?: Record<string, unknown>;
  } = {},
) {
  const registry = { register: vi.fn() } as unknown as SetupFlowRegistry;
  const destinations = options.destinations ?? {
    ebook: { libraryId: 1, libraryName: 'Fiction', folderId: null },
    audiobook: { libraryId: 2, libraryName: 'Audiobooks', folderId: null },
  };
  const flow = new BookRequestSetupFlow(
    registry,
    { get: vi.fn().mockResolvedValue({ ...SETTINGS, ...options.settings }) } as unknown as RequestAutomationSettingsService,
    {
      findAll: vi.fn().mockResolvedValue({ indexers: options.sources ?? [source()], encryptionConfigured: true }),
    } as unknown as IndexerConfigService,
    {
      findAll: vi.fn().mockResolvedValue({ clients: options.clients ?? [client()], encryptionConfigured: true }),
    } as unknown as DownloadClientConfigService,
    { getDefaultDestinations: vi.fn().mockResolvedValue(destinations) } as unknown as BookRequestService,
  );
  return { flow, registry };
}

async function card(options: Parameters<typeof build>[0] = {}) {
  return (await build(options).flow.build()).card;
}

describe('BookRequestSetupFlow', () => {
  it('registers itself with the setup registry', () => {
    const { flow, registry } = build();
    flow.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(flow);
  });

  it('leaves the card out entirely when nothing is configured', async () => {
    const built = await build({ sources: [], clients: [] }).flow.build();
    expect(built.card).toBeNull();
    expect(built.map).toBeNull();
    expect(built.stats).toEqual([{ code: 'sources', label: { key: 'setupOverview.requests.stats.sources', values: { count: 0 } }, value: 0 }]);
  });

  it('puts the auto-search interval on the wire and loops the branch back on itself', async () => {
    const built = await card();
    expect(built?.steps.find((s) => s.id === 'searched')?.edge).toEqual({ key: 'setupOverview.requests.edges.retry', values: { hours: 24 } });
    expect(built?.branch).toMatchObject({ at: 'searched', back: 'searched' });
  });

  it('says releases are picked by hand when nothing grabs by itself', async () => {
    const built = await card({ settings: { autoSearchEnabled: false, autoGrabEnabled: false } });
    expect(built?.branch).toBeNull();
    expect(built?.steps.find((s) => s.id === 'picked')?.lines).toEqual([{ key: 'setupOverview.requests.lines.pickedByHand' }]);
  });

  it('reports a source that is enabled but failing its searches', async () => {
    const built = await card({ sources: [source({ lastSearchOk: false, searchFailureStreak: 2 })] });
    expect(built?.state).toBe('attention');
    expect(built?.warnings).toContainEqual(expect.objectContaining({ code: 'indexer_searches_failing', subject: 'Prowlarr' }));
    expect(built?.table?.rows[0].at(-1)).toMatchObject({ state: 'bad' });
  });

  it('reports a download client that did not answer its last test', async () => {
    const built = await card({ clients: [client({ lastTestOk: false })] });
    expect(built?.warnings).toContainEqual(expect.objectContaining({ code: 'client_unreachable', subject: 'qBittorrent' }));
  });

  it('warns once per media kind with nowhere to land', async () => {
    const built = await card({
      destinations: {
        ebook: { libraryId: null, libraryName: null, folderId: null },
        audiobook: { libraryId: null, libraryName: null, folderId: null },
      },
    });
    const codes = built?.warnings.filter((w) => w.code === 'no_destination') ?? [];
    expect(codes.map((w) => w.detail.key)).toEqual([
      'setupOverview.requests.warnings.noDestination.ebook',
      'setupOverview.requests.warnings.noDestination.audiobook',
    ]);
    expect(built?.steps.at(-1)?.lines).toEqual([{ key: 'setupOverview.requests.lines.filedNowhere' }]);
  });

  it('names the media kinds a source is used for by message, never by enum value', async () => {
    const built = await card({ sources: [source({ disabledMediaKinds: ['audiobook'] })] });
    expect(built?.table?.rows[0]?.[2]?.text).toEqual({ key: 'setupOverview.requests.cells.only.ebook' });
  });

  it('calls a plugin source a plugin rather than inventing a message for its type', async () => {
    const built = await card({ sources: [source({ adapterType: 'librivox' })] });
    expect(built?.table?.rows[0]?.[1]?.text).toEqual({ key: 'setupOverview.requests.kinds.plugin' });
  });

  it('never reports zero failed searches for a source whose last search failed', async () => {
    const built = await card({ sources: [source({ lastSearchOk: false, searchFailureStreak: 0 })] });
    expect(built?.warnings[0]?.detail).toEqual({ key: 'setupOverview.requests.warnings.sourceFailing', values: { count: 1 } });
  });

  it('draws the request lane into the dock, where a finished download is filed', async () => {
    const { map } = await build().flow.build();
    const lane = map?.lanes?.[0];
    expect(lane?.id).toBe('asked');
    expect(lane?.into).toBe('dock-files');
    expect(lane?.stations.map((s) => s.id)).toEqual(['searched', 'downloaded']);
    expect(lane?.stations[1]?.sub).toEqual({ key: 'raw', values: { text: 'qBittorrent' } });
    expect(lane?.note).toEqual({ key: 'setupOverview.requests.edges.checked', values: { score: 70 } });
  });

  it('counts clients instead of naming one when several are on', async () => {
    const { map } = await build({ clients: [client(), client({ id: 2, name: 'SABnzbd' })] }).flow.build();
    expect(map?.lanes?.[0]?.stations[1]?.sub).toEqual({ key: 'setupOverview.requests.lines.downloadedA', values: { count: 2 } });
  });

  it('never puts a base URL or a credential on the page', async () => {
    const built = await build({ sources: [source({ baseUrl: 'https://secret.example/api' } as Partial<IndexerItem>)] }).flow.build();
    expect(JSON.stringify(built)).not.toContain('secret.example');
  });
});
