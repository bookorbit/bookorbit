import { Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  BookDockDockCounts,
  BookDockSettings,
  BookDockSummary,
  LibraryDockAdminEntry,
  LibraryDocksAdmin,
  SetupCell,
  SetupFlowCard,
  SetupMapFragment,
  SetupStat,
  SetupText,
  SetupWarning,
} from '@bookorbit/types';
import { setupRaw } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { SETUP_MAP_STATIONS, setupTextFor, type SetupFlowContribution, type SetupFlowContributor } from '../setup-overview/setup-flow';
import { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import { BookDockService } from './book-dock.service';
import { LibraryDockService } from './library-dock.service';

const t = setupTextFor('ingest');

const DOCK_PAGE = '/settings/admin/book-dock';

/** The dock root, which takes everything no library dock claims. */
const UNSORTED_DOCK_ID = null;

type Library = Awaited<ReturnType<LibraryService['findAll']>>[number];

/**
 * "Books coming in": the docks, what each one files by itself, and what is waiting, plus the two
 * ways in the map draws for this flow, the dock and a library's own folders.
 *
 * Counts come from the dock summary, which is already aggregated per dock, so describing the flow
 * costs the same handful of queries however many files are sitting in it.
 */
@Injectable()
export class BookDockSetupFlow implements SetupFlowContributor, OnModuleInit {
  readonly id = 'ingest' as const;

  constructor(
    private readonly registry: SetupFlowRegistry,
    private readonly appSettings: AppSettingsService,
    private readonly docks: LibraryDockService,
    private readonly dock: BookDockService,
    private readonly libraries: LibraryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build(viewer: RequestUser): Promise<SetupFlowContribution> {
    const [settings, admin, summary, libraries] = await Promise.all([
      this.appSettings.getBookDockSettings(),
      this.docks.getAdmin(viewer),
      this.dock.getSummary(),
      this.libraries.findAll(viewer),
    ]);

    const withDock = admin.libraries.filter((entry) => entry.dock !== null);
    const onHold = summary.docks ? summary.docks.reduce((sum, c) => sum + c.onHold, 0) : summary.needsReview;

    const stats: SetupStat[] = [
      { code: 'libraries', label: t('stats.libraries', { count: libraries.length }), value: libraries.length },
      { code: 'docks', label: t('stats.docks', { count: withDock.length }), value: withDock.length },
    ];

    return {
      card: this.card(settings, admin, withDock, summary, onHold),
      stats,
      map: this.map(settings, libraries, onHold),
    };
  }

  private card(
    settings: BookDockSettings,
    admin: LibraryDocksAdmin,
    withDock: LibraryDockAdminEntry[],
    summary: BookDockSummary,
    onHold: number,
  ): SetupFlowCard {
    const live = withDock.filter((e) => e.dock?.enabled && e.folderPresent);
    const counts = new Map<number | null, BookDockDockCounts>((summary.docks ?? []).map((c) => [c.dockId, c]));
    const autoFiling = live.filter((e) => e.effective.autoFinalizeEnabled);
    const autoFetching = live.filter((e) => e.effective.autoFetchMetadata);
    const warnings = this.warnings(admin, withDock, summary);

    return {
      id: this.id,
      icon: 'package-open',
      title: t('title'),
      summary: t('summary', { docks: withDock.length, libraries: admin.libraries.length }),
      state: warnings.length > 0 ? 'attention' : 'ok',
      stateLabel: warnings.length > 0 ? t('state.attention', { count: warnings.length }) : t('state.ok'),
      steps: [
        {
          id: 'arrives',
          icon: 'upload',
          label: t('steps.arrives'),
          lines: [t('lines.arrivesA'), t('lines.arrivesB')],
          edge: t('edges.docks', { count: live.length }),
        },
        {
          id: 'read',
          icon: 'file-text',
          label: t('steps.read'),
          lines: [t('lines.readA'), t('lines.readB')],
          edge: t('edges.fetch', { count: autoFetching.length }),
        },
        {
          id: 'matched',
          icon: 'search',
          label: t('steps.matched'),
          lines: [t('lines.matchedA')],
          edge: settings.autoFinalizeEnabled ? t('edges.threshold', { percent: settings.autoFinalizeThreshold }) : t('edges.byHand'),
        },
        {
          id: 'files',
          icon: 'check',
          label: t('steps.files'),
          lines: [t('lines.filesA', { auto: autoFiling.length, total: live.length }), t('lines.filesB')],
          edge: t('edges.filed'),
        },
        { id: 'library', icon: 'library', label: t('steps.library'), lines: [], edge: null, terminal: true },
      ],
      branch: onHold > 0 ? { at: 'matched', back: 'files', label: t('branch.onHold'), sub: t('branch.waiting', { count: onHold }) } : null,
      facts: [
        t('facts.folder'),
        t('facts.unsorted'),
        t(`facts.mode.${settings.autoFinalizeMetadataMode}`),
        settings.autoFinalizeEnabled ? t('facts.autoOn', { percent: settings.autoFinalizeThreshold }) : t('facts.autoOff'),
      ],
      table: {
        columns: [t('table.dock'), t('table.folder'), t('table.filesAt'), t('table.metadata'), t('table.filing'), t('table.state')],
        rows: [
          ...withDock.map((entry) => this.row(entry, entry.dock ? counts.get(entry.dock.id) : undefined)),
          this.unsortedRow(settings, counts.get(UNSORTED_DOCK_ID), summary.paused),
        ],
      },
      warnings,
      links: [
        { label: t('links.bookDock'), icon: 'package-open', url: DOCK_PAGE },
        { label: t('links.libraries'), icon: 'library', url: '/settings/libraries' },
      ],
    };
  }

  /**
   * Two of the three ways in: the dock, drawn as a band around what it does to a file, and a
   * library's own folders, which a scan reads straight into the library. Requests join the dock at
   * its last station, so they are drawn by the requests flow.
   */
  private map(settings: BookDockSettings, libraries: Library[], onHold: number): SetupMapFragment {
    const books = libraries.reduce((sum, library) => sum + (library.bookCount ?? 0), 0);
    const watched = libraries.filter((library) => library.watch).length;
    const scheduled = libraries.filter((library) => library.autoScanCronExpression).length;

    return {
      lanes: [
        {
          id: 'dropped',
          caption: t('map.dropped'),
          entries: [
            { id: 'upload', icon: 'upload', label: t('map.upload'), sub: null },
            { id: 'dock-folder', icon: 'folder-input', label: t('map.dockFolder'), sub: null },
          ],
          stations: [
            { id: 'dock-read', icon: 'file-text', label: t('steps.read'), sub: t('map.readSub') },
            { id: SETUP_MAP_STATIONS.dockMatched, icon: 'search', label: t('steps.matched'), sub: t('map.matchedSub') },
            {
              id: SETUP_MAP_STATIONS.dockFiles,
              icon: 'check',
              label: t('steps.files'),
              sub: settings.autoFinalizeEnabled ? t('edges.threshold', { percent: settings.autoFinalizeThreshold }) : t('edges.byHand'),
            },
          ],
          into: null,
          note: null,
          branch: onHold > 0 ? { at: SETUP_MAP_STATIONS.dockFiles, label: t('map.onHold', { count: onHold }) } : null,
        },
        {
          id: 'disk',
          caption: t('map.onDisk'),
          entries: [{ id: 'library-folder', icon: 'folder-search', label: t('map.libraryFolder'), sub: null }],
          stations: [{ id: 'scanned', icon: 'rotate-cw', label: t('map.scanned'), sub: this.scanSub(watched, scheduled) }],
          into: null,
          note: null,
          branch: null,
        },
      ],
      library: {
        label: t('map.library'),
        sub: t('map.books', { count: books }),
        foot: t('map.libraries', { count: libraries.length }),
      },
    };
  }

  private scanSub(watched: number, scheduled: number): SetupText {
    if (watched > 0 && scheduled > 0) return t('map.scanBoth', { watched, scheduled });
    if (watched > 0) return t('map.scanWatched', { count: watched });
    if (scheduled > 0) return t('map.scanScheduled', { count: scheduled });
    return t('map.scanByHand');
  }

  private row(entry: LibraryDockAdminEntry, counts: BookDockDockCounts | undefined): SetupCell[] {
    const dock = entry.dock;
    return [
      { text: setupRaw(entry.libraryName) },
      { text: setupRaw(dock?.folderName ?? ''), dim: true },
      { text: entry.effective.autoFinalizeEnabled ? t('cells.at', { percent: entry.effective.autoFinalizeThreshold }) : t('cells.never'), dim: true },
      { text: t(`cells.mode.${entry.effective.autoFinalizeMetadataMode}`), dim: true },
      { text: entry.effective.keepOriginal ? t('cells.keepsOriginal') : t('cells.moves'), dim: true },
      this.stateCell(entry, counts),
    ];
  }

  private stateCell(entry: LibraryDockAdminEntry, counts: BookDockDockCounts | undefined): SetupCell {
    if (!entry.folderPresent) return { text: t('cells.folderMissing'), state: 'warn' };
    if (!entry.dock?.enabled) return { text: t('cells.off'), state: 'off' };
    const waiting = counts?.onHold ?? 0;
    if (waiting > 0) return { text: t('cells.onWaiting', { count: waiting }), state: 'warn' };
    return { text: t('cells.on'), state: 'on' };
  }

  private unsortedRow(settings: BookDockSettings, counts: BookDockDockCounts | undefined, paused: boolean): SetupCell[] {
    const waiting = counts?.onHold ?? 0;
    return [
      { text: t('cells.unsorted') },
      { text: t('cells.dockRoot'), dim: true },
      { text: settings.autoFinalizeEnabled ? t('cells.at', { percent: settings.autoFinalizeThreshold }) : t('cells.never'), dim: true },
      { text: t(`cells.mode.${settings.autoFinalizeMetadataMode}`), dim: true },
      { text: settings.unsortedKeepOriginal ? t('cells.keepsOriginal') : t('cells.moves'), dim: true },
      paused
        ? { text: t('cells.paused'), state: 'warn' }
        : waiting > 0
          ? { text: t('cells.onWaiting', { count: waiting }), state: 'warn' }
          : { text: t('cells.on'), state: 'on' },
    ];
  }

  private warnings(admin: LibraryDocksAdmin, withDock: LibraryDockAdminEntry[], summary: BookDockSummary): SetupWarning[] {
    const out: SetupWarning[] = [];
    if (summary.paused) {
      out.push({ code: 'dock_paused', subject: null, detail: t('warnings.paused'), fix: t('warnings.fix.openDock'), url: DOCK_PAGE });
    }
    for (const entry of withDock) {
      if (!entry.folderPresent) {
        out.push({
          code: 'dock_folder_missing',
          subject: entry.libraryName,
          detail: t('warnings.folderMissing'),
          fix: t('warnings.fix.chooseFolder'),
          url: DOCK_PAGE,
        });
      } else if (entry.dock?.targetFolderId === null) {
        out.push({
          code: 'dock_no_folder',
          subject: entry.libraryName,
          detail: t('warnings.noFolder'),
          fix: t('warnings.fix.chooseFolder'),
          url: DOCK_PAGE,
        });
      }
    }
    if (admin.unrecognisedFolders.length > 0) {
      out.push({
        code: 'dock_unrecognised_folders',
        subject: null,
        detail: t('warnings.unrecognised', { count: admin.unrecognisedFolders.length }),
        fix: t('warnings.fix.openDock'),
        url: DOCK_PAGE,
      });
    }
    if (admin.strayFiles.length > 0) {
      out.push({
        code: 'dock_stray_files',
        subject: null,
        detail: admin.strayFilesTruncated
          ? t('warnings.strayMany', { count: admin.strayFiles.length })
          : t('warnings.stray', { count: admin.strayFiles.length }),
        fix: t('warnings.fix.openDock'),
        url: DOCK_PAGE,
      });
    }
    return out;
  }
}
