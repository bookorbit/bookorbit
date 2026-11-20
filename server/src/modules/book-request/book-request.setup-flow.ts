import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  BOOK_REQUEST_MEDIA_KINDS,
  INDEXER_ADAPTER_TYPES,
  setupRaw,
  type BookRequestAutomationSettings,
  type DownloadClientItem,
  type IndexerItem,
  type ResolvedRequestDestination,
  type SetupCell,
  type SetupFlowCard,
  type SetupMapFragment,
  type SetupText,
  type SetupWarning,
} from '@bookorbit/types';

import { SETUP_MAP_STATIONS, setupTextFor, type SetupFlowContribution, type SetupFlowContributor } from '../setup-overview/setup-flow';
import { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import { BookRequestService } from './book-request.service';
import { DownloadClientConfigService } from './download-clients/download-client-config.service';
import { RequestAutomationSettingsService } from './fulfillment/request-automation-settings.service';
import { IndexerConfigService } from './indexers/indexer-config.service';

const t = setupTextFor('requests');

const REQUESTS_SETTINGS = '/settings/admin/requests';

/**
 * "Books you ask for": where a request searches, what takes the release, and where it lands.
 *
 * Nothing here carries a base URL or a credential. Which sources exist, what they are for and
 * whether they answered is the whole of what this page needs; where they live is the business of
 * the page that configures them.
 */
@Injectable()
export class BookRequestSetupFlow implements SetupFlowContributor, OnModuleInit {
  readonly id = 'requests' as const;

  constructor(
    private readonly registry: SetupFlowRegistry,
    private readonly automation: RequestAutomationSettingsService,
    private readonly indexers: IndexerConfigService,
    private readonly clients: DownloadClientConfigService,
    private readonly requests: BookRequestService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build(): Promise<SetupFlowContribution> {
    const [settings, indexerList, clientList, destinations] = await Promise.all([
      this.automation.get(),
      this.indexers.findAll(),
      this.clients.findAll(),
      this.requests.getDefaultDestinations(),
    ]);

    const sources = indexerList.indexers;
    const clients = clientList.clients;
    const liveSources = sources.filter((s) => s.enabled);
    const stats = [{ code: 'sources', label: t('stats.sources', { count: liveSources.length }), value: liveSources.length }];
    if (sources.length === 0 && clients.length === 0) return { card: null, stats, map: null };

    return {
      card: this.card(settings, sources, clients, destinations),
      stats,
      map: this.map(
        settings,
        liveSources,
        clients.filter((c) => c.enabled),
      ),
    };
  }

  private card(
    settings: BookRequestAutomationSettings,
    sources: IndexerItem[],
    clients: DownloadClientItem[],
    destinations: Record<string, ResolvedRequestDestination>,
  ): SetupFlowCard {
    const liveSources = sources.filter((s) => s.enabled);
    const liveClients = clients.filter((c) => c.enabled);
    const warnings = this.warnings(sources, clients, destinations);

    return {
      id: this.id,
      icon: 'download',
      title: t('title'),
      summary: t('summary', { sources: liveSources.length, clients: liveClients.length }),
      state: warnings.length > 0 ? 'attention' : liveSources.length === 0 ? 'off' : 'ok',
      stateLabel: warnings.length > 0 ? t('state.attention', { count: warnings.length }) : liveSources.length === 0 ? t('state.off') : t('state.ok'),
      steps: [
        {
          id: 'asked',
          icon: 'inbox',
          label: t('steps.asked'),
          lines: [t('lines.askedA'), t('lines.askedB')],
          edge: t('edges.approved'),
        },
        {
          id: 'searched',
          icon: 'search',
          label: t('steps.searched'),
          lines: [t('lines.searchedA', { count: liveSources.length })],
          edge: settings.autoSearchEnabled ? t('edges.retry', { hours: settings.autoSearchIntervalHours }) : t('edges.onAsk'),
        },
        {
          id: 'picked',
          icon: 'list-checks',
          label: t('steps.picked'),
          lines: settings.autoGrabEnabled
            ? [t('lines.pickedA'), t('lines.pickedAuto', { score: settings.autoGrabMinScore })]
            : [t('lines.pickedByHand')],
          edge: t('edges.sent'),
        },
        {
          id: 'downloaded',
          icon: 'download',
          label: t('steps.downloaded'),
          lines: [t('lines.downloadedA', { count: liveClients.length }), t('lines.downloadedB', { tries: settings.maxAutoGrabAttempts })],
          edge: settings.verificationEnabled ? t('edges.checked', { score: settings.verificationThreshold }) : t('edges.unchecked'),
        },
        { id: 'filed', icon: 'library', label: t('steps.filed'), lines: this.landing(destinations), edge: null, terminal: true },
      ],
      branch: settings.autoSearchEnabled
        ? {
            at: 'searched',
            back: 'searched',
            label: t('branch.nothingFound'),
            sub: t('branch.triesAgain', { hours: settings.autoSearchIntervalHours }),
          }
        : null,
      facts: this.facts(settings),
      table: {
        columns: [t('table.source'), t('table.kind'), t('table.usedFor'), t('table.state')],
        rows: [...sources.map((s) => this.sourceRow(s)), ...clients.map((c) => this.clientRow(c))],
      },
      warnings,
      links: [
        { label: t('links.indexers'), icon: 'search', url: REQUESTS_SETTINGS },
        { label: t('links.clients'), icon: 'download', url: REQUESTS_SETTINGS },
        { label: t('links.requests'), icon: 'sliders-horizontal', url: '/requests' },
      ],
    };
  }

  /**
   * The top lane of the map. A finished download is linked into the Book Dock and filed from there,
   * so the lane ends at the dock's filing station rather than at the library.
   */
  private map(settings: BookRequestAutomationSettings, liveSources: IndexerItem[], liveClients: DownloadClientItem[]): SetupMapFragment {
    const onlyClient = liveClients.length === 1 ? liveClients[0] : undefined;
    return {
      lanes: [
        {
          id: 'asked',
          caption: t('map.asked'),
          entries: [{ id: 'request', icon: 'inbox', label: t('map.request'), sub: null }],
          stations: [
            { id: 'searched', icon: 'search', label: t('steps.searched'), sub: t('lines.searchedA', { count: liveSources.length }) },
            {
              id: 'downloaded',
              icon: 'download',
              label: t('steps.downloaded'),
              sub: onlyClient ? setupRaw(onlyClient.name) : t('lines.downloadedA', { count: liveClients.length }),
            },
          ],
          into: SETUP_MAP_STATIONS.dockFiles,
          note: settings.verificationEnabled ? t('edges.checked', { score: settings.verificationThreshold }) : t('map.intoDock'),
          branch: null,
        },
      ],
    };
  }

  /** At most two lines, so the drawing stays readable: the libraries a request can land in. */
  private landing(destinations: Record<string, ResolvedRequestDestination>): SetupText[] {
    const named = BOOK_REQUEST_MEDIA_KINDS.map((kind) => destinations[kind]?.libraryName).filter((name): name is string => Boolean(name));
    const unique = [...new Set(named)];
    if (unique.length === 0) return [t('lines.filedNowhere')];
    return [setupRaw(unique.slice(0, 2).join(' · ')), unique.length > 2 ? t('lines.filedMore', { count: unique.length - 2 }) : t('lines.filedB')];
  }

  private facts(settings: BookRequestAutomationSettings): SetupText[] {
    const facts: SetupText[] = [];
    facts.push(settings.autoGrabEnabled ? t('facts.autoGrab', { score: settings.autoGrabMinScore }) : t('facts.byHand'));
    facts.push(settings.verificationEnabled ? t('facts.verify', { score: settings.verificationThreshold }) : t('facts.noVerify'));
    facts.push(settings.autoRetryEnabled ? t('facts.retry', { tries: settings.maxAutoGrabAttempts }) : t('facts.noRetry'));
    facts.push(t(`facts.formats.${settings.importFormats}`));
    if (settings.autoSearchEnabled) facts.push(t('facts.autoSearch', { days: settings.autoSearchMaxAgeDays }));
    return facts;
  }

  private sourceRow(source: IndexerItem): SetupCell[] {
    const builtIn = (INDEXER_ADAPTER_TYPES as readonly string[]).includes(source.adapterType);
    return [
      { text: setupRaw(source.name) },
      { text: builtIn ? t(`kinds.${source.adapterType}`) : t('kinds.plugin'), dim: true },
      { text: this.usedFor(source), dim: true },
      this.sourceState(source),
    ];
  }

  /** Which kinds of book a source is asked for, named by the catalog rather than by the enum. */
  private usedFor(source: IndexerItem): SetupText {
    const kinds = BOOK_REQUEST_MEDIA_KINDS.filter((kind) => !source.disabledMediaKinds.includes(kind));
    if (kinds.length === BOOK_REQUEST_MEDIA_KINDS.length) return t('cells.allKinds');
    if (kinds.length === 0) return t('cells.noKinds');
    return kinds.length === 1 ? t(`cells.only.${kinds[0]}`) : t('cells.someKinds', { count: kinds.length });
  }

  /** A source can be enabled and still be refusing every search, which is the state worth seeing. */
  private sourceState(source: IndexerItem): SetupCell {
    if (!source.enabled) return { text: t('cells.off'), state: 'off' };
    if (this.failing(source)) return { text: t('cells.failingSearches', { count: Math.max(1, source.searchFailureStreak) }), state: 'bad' };
    if (source.lastTestOk === false) return { text: t('cells.testFailed'), state: 'warn' };
    return { text: t('cells.on'), state: 'on' };
  }

  private failing(source: IndexerItem): boolean {
    return source.lastSearchOk === false || source.searchFailureStreak > 0;
  }

  private clientRow(client: DownloadClientItem): SetupCell[] {
    return [
      { text: setupRaw(client.name) },
      { text: t('kinds.client'), dim: true },
      { text: client.useHardlinks ? t('cells.hardlinks') : t('cells.copies'), dim: true },
      this.clientState(client),
    ];
  }

  private clientState(client: DownloadClientItem): SetupCell {
    if (!client.enabled) return { text: t('cells.off'), state: 'off' };
    if (client.lastTestOk === false) return { text: t('cells.notAnswering'), state: 'bad' };
    return { text: t('cells.on'), state: 'on' };
  }

  private warnings(sources: IndexerItem[], clients: DownloadClientItem[], destinations: Record<string, ResolvedRequestDestination>): SetupWarning[] {
    const out: SetupWarning[] = [];
    if (sources.length > 0 && sources.every((s) => !s.enabled)) {
      out.push({
        code: 'no_enabled_indexer',
        subject: null,
        detail: t('warnings.noSources'),
        fix: t('warnings.fix.openIndexers'),
        url: REQUESTS_SETTINGS,
      });
    }
    if (sources.some((s) => s.enabled) && clients.every((c) => !c.enabled)) {
      out.push({
        code: 'no_enabled_client',
        subject: null,
        detail: t('warnings.noClients'),
        fix: t('warnings.fix.openClients'),
        url: REQUESTS_SETTINGS,
      });
    }
    for (const source of sources) {
      if (source.enabled && this.failing(source)) {
        out.push({
          code: 'indexer_searches_failing',
          subject: source.name,
          detail: t('warnings.sourceFailing', { count: Math.max(1, source.searchFailureStreak) }),
          fix: t('warnings.fix.openIndexers'),
          url: REQUESTS_SETTINGS,
        });
      }
    }
    for (const client of clients) {
      if (client.enabled && client.lastTestOk === false) {
        out.push({
          code: 'client_unreachable',
          subject: client.name,
          detail: t('warnings.clientFailing'),
          fix: t('warnings.fix.testIt'),
          url: REQUESTS_SETTINGS,
        });
      }
    }
    for (const kind of BOOK_REQUEST_MEDIA_KINDS) {
      if (!destinations[kind]?.libraryId) {
        out.push({
          code: 'no_destination',
          subject: null,
          detail: t(`warnings.noDestination.${kind}`),
          fix: t('warnings.fix.setDestination'),
          url: REQUESTS_SETTINGS,
        });
      }
    }
    return out;
  }
}
