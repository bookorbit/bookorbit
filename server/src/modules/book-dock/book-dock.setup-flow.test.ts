import { describe, expect, it, vi } from 'vitest';
import type { BookDockSettings, BookDockSummary, LibraryDocksAdmin } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { AppSettingsService } from '../app-settings/app-settings.service';
import type { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import type { LibraryService } from '../library/library.service';
import type { BookDockService } from './book-dock.service';
import { BookDockSetupFlow } from './book-dock.setup-flow';
import type { LibraryDockService } from './library-dock.service';

const viewer = { id: 7 } as RequestUser;

const SETTINGS: BookDockSettings = {
  bookDockPath: '/dock',
  autoFetchMetadata: true,
  autoFinalizeEnabled: true,
  autoFinalizeThreshold: 85,
  autoFinalizeLibraryId: null,
  autoFinalizeFolderId: null,
  autoFinalizeMetadataMode: 'safe_merge',
} as BookDockSettings;

function entry(over: Partial<ReturnType<typeof baseEntry>> = {}) {
  return { ...baseEntry(), ...over };
}

function baseEntry() {
  return {
    libraryId: 1,
    libraryName: 'Fiction',
    folders: [],
    dock: {
      id: 11,
      libraryId: 1,
      libraryName: 'Fiction',
      folderName: 'Fiction',
      enabled: true,
      targetFolderId: 4,
      overrides: {},
      autoJoin: false,
      keepOriginal: false,
    },
    effective: {
      autoFetchMetadata: true,
      autoFinalizeEnabled: true,
      autoFinalizeThreshold: 85,
      autoFinalizeMetadataMode: 'safe_merge' as const,
      autoJoin: false,
      keepOriginal: false,
    },
    suggestedFolderName: null,
    folderPresent: true,
  };
}

type LibraryRow = { id: number; bookCount: number; watch: boolean; autoScanCronExpression: string | null };

function build(
  options: {
    libraries?: ReturnType<typeof baseEntry>[];
    summary?: Partial<BookDockSummary>;
    admin?: Partial<LibraryDocksAdmin>;
    rows?: LibraryRow[];
    settings?: Partial<BookDockSettings>;
  } = {},
) {
  const registry = { register: vi.fn() } as unknown as SetupFlowRegistry;
  const admin = {
    librariesPath: '/dock/_libraries',
    libraries: options.libraries ?? [entry()],
    unrecognisedFolders: [],
    strayFiles: [],
    strayFilesTruncated: false,
    librariesFolderIsBook: false,
    ...options.admin,
  } as LibraryDocksAdmin;
  const summary = {
    pending: 0,
    working: 0,
    ready: 3,
    error: 0,
    needsReview: 0,
    readyToFile: 3,
    total: 3,
    paused: false,
    docks: [],
    ...options.summary,
  } as BookDockSummary;
  const flow = new BookDockSetupFlow(
    registry,
    { getBookDockSettings: vi.fn().mockResolvedValue({ ...SETTINGS, ...options.settings }) } as unknown as AppSettingsService,
    { getAdmin: vi.fn().mockResolvedValue(admin) } as unknown as LibraryDockService,
    { getSummary: vi.fn().mockResolvedValue(summary) } as unknown as BookDockService,
    {
      findAll: vi.fn().mockResolvedValue(
        options.rows ?? [
          { id: 1, bookCount: 1000, watch: true, autoScanCronExpression: null },
          { id: 2, bookCount: 59, watch: false, autoScanCronExpression: '0 3 * * *' },
        ],
      ),
    } as unknown as LibraryService,
  );
  return { flow, registry };
}

async function card(options: Parameters<typeof build>[0] = {}) {
  return (await build(options).flow.build(viewer)).card;
}

describe('BookDockSetupFlow', () => {
  it('registers itself with the setup registry', () => {
    const { flow, registry } = build();
    flow.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(flow);
  });

  it('describes the flow as five steps, the last one where a book lands', async () => {
    const built = await card();
    expect(built?.steps.map((s) => s.id)).toEqual(['arrives', 'read', 'matched', 'files', 'library']);
    expect(built?.steps.filter((s) => s.terminal)).toHaveLength(1);
    expect(built?.steps.at(-1)?.terminal).toBe(true);
    expect(built?.steps.at(-1)?.edge).toBeNull();
  });

  it('puts the dock threshold on the wire into filing', async () => {
    const built = await card();
    expect(built?.steps.find((s) => s.id === 'matched')?.edge).toEqual({ key: 'setupOverview.ingest.edges.threshold', values: { percent: 85 } });
  });

  it('draws the hold branch only when files are waiting', async () => {
    const none = await card();
    expect(none?.branch).toBeNull();

    const waiting = await card({
      summary: { docks: [{ dockId: 11, total: 4, working: 0, onHold: 2, ready: 2, error: 0, keptForSeeding: 0 }] },
    });
    expect(waiting?.branch).toMatchObject({ at: 'matched', back: 'files' });
    expect(waiting?.branch?.sub).toEqual({ key: 'setupOverview.ingest.branch.waiting', values: { count: 2 } });
  });

  it('warns when a dock folder is gone and marks the flow as needing a person', async () => {
    const built = await card({ libraries: [entry({ folderPresent: false })] });
    expect(built?.state).toBe('attention');
    expect(built?.warnings).toEqual([expect.objectContaining({ code: 'dock_folder_missing', subject: 'Fiction', url: '/settings/admin/book-dock' })]);
  });

  it('lists every dock and Unsorted, and passes names through untranslated', async () => {
    const built = await card({
      libraries: [
        entry(),
        entry({
          libraryId: 2,
          libraryName: 'Comics',
          dock: { ...baseEntry().dock, id: 12, libraryId: 2, libraryName: 'Comics', folderName: 'Manga', enabled: false },
        }),
      ],
    });
    expect(built?.table?.rows).toHaveLength(3);
    expect(built?.table?.rows[1][0].text).toEqual({ key: 'raw', values: { text: 'Comics' } });
    expect(built?.table?.rows[1].at(-1)).toMatchObject({ state: 'off' });
    expect(built?.table?.rows[2][0].text).toEqual({ key: 'setupOverview.ingest.cells.unsorted' });
  });

  it('does not count a switched-off dock as filing by itself', async () => {
    const built = await card({
      libraries: [entry(), entry({ libraryId: 2, libraryName: 'Comics', dock: { ...baseEntry().dock, id: 12, enabled: false } })],
    });
    expect(built?.steps.find((s) => s.id === 'files')?.lines[0]).toEqual({ key: 'setupOverview.ingest.lines.filesA', values: { auto: 1, total: 1 } });
  });

  it("says what Unsorted does with the original rather than always 'moves'", async () => {
    const built = await card({ settings: { unsortedKeepOriginal: true } });
    expect(built?.table?.rows.at(-1)?.[4].text).toEqual({ key: 'setupOverview.ingest.cells.keepsOriginal' });
  });

  it('names the metadata mode by message rather than printing the raw code', async () => {
    const built = await card();
    expect(built?.facts).toContainEqual({ key: 'setupOverview.ingest.facts.mode.safe_merge' });
  });

  it('warns when the dock is paused, and about folders and files no dock takes in', async () => {
    const built = await card({
      summary: { paused: true },
      admin: { unrecognisedFolders: [{ name: 'Old', matchesLibraryId: null }], strayFiles: ['a.epub', 'b.epub'], strayFilesTruncated: false },
    });
    expect(built?.warnings.map((w) => w.code)).toEqual(['dock_paused', 'dock_unrecognised_folders', 'dock_stray_files']);
    expect(built?.warnings[2]?.detail).toEqual({ key: 'setupOverview.ingest.warnings.stray', values: { count: 2 } });
    expect(built?.table?.rows.at(-1)?.at(-1)).toMatchObject({ state: 'warn', text: { key: 'setupOverview.ingest.cells.paused' } });
  });

  it('counts libraries, and only the libraries that actually have a dock as docks', async () => {
    const { stats } = await build({ libraries: [entry(), entry({ libraryId: 3, libraryName: 'Kids', dock: null })] }).flow.build(viewer);
    expect(stats).toEqual([
      { code: 'libraries', label: { key: 'setupOverview.ingest.stats.libraries', values: { count: 2 } }, value: 2 },
      { code: 'docks', label: { key: 'setupOverview.ingest.stats.docks', values: { count: 1 } }, value: 1 },
    ]);
  });

  describe('the map', () => {
    it('draws the dock as three stations and a library folder as a scan, both into the library', async () => {
      const { map } = await build().flow.build(viewer);
      expect(map?.lanes?.map((lane) => lane.id)).toEqual(['dropped', 'disk']);
      expect(map?.lanes?.[0]?.stations.map((s) => s.id)).toEqual(['dock-read', 'dock-matched', 'dock-files']);
      expect(map?.lanes?.[0]?.entries.map((e) => e.id)).toEqual(['upload', 'dock-folder']);
      expect(map?.lanes?.every((lane) => lane.into === null)).toBe(true);
      expect(map?.lanes?.[0]?.stations[2]?.sub).toEqual({ key: 'setupOverview.ingest.edges.threshold', values: { percent: 85 } });
    });

    it('counts the books and libraries the library circle carries', async () => {
      const { map } = await build().flow.build(viewer);
      expect(map?.library).toEqual({
        label: { key: 'setupOverview.ingest.map.library' },
        sub: { key: 'setupOverview.ingest.map.books', values: { count: 1059 } },
        foot: { key: 'setupOverview.ingest.map.libraries', values: { count: 2 } },
      });
    });

    it('says how libraries are scanned', async () => {
      const both = (await build().flow.build(viewer)).map?.lanes?.[1]?.stations[0]?.sub;
      expect(both).toEqual({ key: 'setupOverview.ingest.map.scanBoth', values: { watched: 1, scheduled: 1 } });
      const byHand = (await build({ rows: [{ id: 1, bookCount: 3, watch: false, autoScanCronExpression: null }] }).flow.build(viewer)).map?.lanes?.[1]
        ?.stations[0]?.sub;
      expect(byHand).toEqual({ key: 'setupOverview.ingest.map.scanByHand' });
    });

    it('hangs work on hold off the filing station only when there is some', async () => {
      expect((await build().flow.build(viewer)).map?.lanes?.[0]?.branch).toBeNull();
      const waiting = await build({
        summary: { docks: [{ dockId: 11, total: 1, working: 0, onHold: 1, ready: 0, error: 0, keptForSeeding: 0 }] },
      }).flow.build(viewer);
      expect(waiting.map?.lanes?.[0]?.branch).toEqual({ at: 'dock-files', label: { key: 'setupOverview.ingest.map.onHold', values: { count: 1 } } });
    });
  });
});
