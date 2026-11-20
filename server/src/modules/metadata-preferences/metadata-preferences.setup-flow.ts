import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ALL_METADATA_FIELDS,
  BUILT_IN_METADATA_PROVIDER_LABELS,
  MOVED_METADATA_PROVIDERS,
  setupRaw,
  type MetadataField,
  type MetadataFetchPreferences,
  type SetupCell,
  type SetupFlowCard,
  type SetupText,
  type SetupWarning,
} from '@bookorbit/types';

import { SETUP_MAP_STATIONS, setupTextFor, type SetupFlowContribution, type SetupFlowContributor } from '../setup-overview/setup-flow';
import { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import { MetadataPreferencesService } from './metadata-preferences.service';

const t = setupTextFor('metadata');

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  ...BUILT_IN_METADATA_PROVIDER_LABELS,
  ...Object.fromEntries(Object.entries(MOVED_METADATA_PROVIDERS).map(([key, moved]) => [key, moved.label])),
};

/** A provider's display name; one an admin registered keeps its key, which is the name they gave it. */
const providerName = (key: string): string => PROVIDER_LABELS[key] ?? key;

/** Field names the app already names elsewhere, so this page does not keep a second copy of them. */
const fieldLabel = (field: MetadataField): SetupText => ({ key: `settings.metadata.fields.${field}` });

const PREFERENCES_PAGE = '/settings/metadata/field-rules';

/** The fields worth drawing a row for: the ones a person recognises on a book. */
const HEADLINE_FIELDS: MetadataField[] = ['title', 'authors', 'cover', 'description', 'genres', 'seriesName', 'publishedYear'];

/**
 * "Where metadata comes from": which provider answers for which field, in what order, and what
 * happens when the book already has one.
 *
 * Read from the saved preferences alone, so it costs a single row however many providers are
 * installed.
 */
@Injectable()
export class MetadataPreferencesSetupFlow implements SetupFlowContributor, OnModuleInit {
  readonly id = 'metadata' as const;

  constructor(
    private readonly registry: SetupFlowRegistry,
    private readonly preferences: MetadataPreferencesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build(): Promise<SetupFlowContribution> {
    const prefs = await this.preferences.getGlobal();
    const providers = this.providers(prefs);
    return {
      card: this.card(prefs, providers),
      stats: [{ code: 'providers', label: t('stats.providers', { count: providers.size }), value: providers.size }],
      map: {
        services: [
          {
            id: 'metadata',
            icon: 'tag',
            label: t('map.service'),
            sub: t('map.serviceSub', { count: providers.size }),
            asks: SETUP_MAP_STATIONS.dockMatched,
          },
        ],
      },
    };
  }

  private card(prefs: MetadataFetchPreferences, providers: Set<string>): SetupFlowCard {
    const enabled = ALL_METADATA_FIELDS.filter((field) => prefs.fields[field]?.enabled);
    const warnings = this.warnings(prefs);
    const genres = prefs.options?.genres;

    return {
      id: this.id,
      icon: 'tag',
      title: t('title'),
      summary: t('summary', { providers: providers.size, fields: enabled.length }),
      state: warnings.length > 0 ? 'attention' : providers.size === 0 ? 'off' : 'ok',
      stateLabel: warnings.length > 0 ? t('state.attention', { count: warnings.length }) : providers.size === 0 ? t('state.off') : t('state.ok'),
      steps: [
        { id: 'book', icon: 'book-open', label: t('steps.book'), lines: [t('lines.bookA'), t('lines.bookB')], edge: t('edges.perField') },
        {
          id: 'asked',
          icon: 'search',
          label: t('steps.asked'),
          lines: [t('lines.askedA', { count: providers.size }), t('lines.askedB')],
          edge: t('edges.firstWins'),
        },
        {
          id: 'merged',
          icon: 'git-merge',
          label: t('steps.merged'),
          lines: [t('lines.mergedA'), genres?.maxCount ? t('lines.mergedB', { count: genres.maxCount }) : t('lines.mergedNoCap')],
          edge: t('edges.saved'),
        },
        {
          id: 'saved',
          icon: 'check-check',
          label: t('steps.saved'),
          lines: [t('lines.savedA', { count: enabled.length })],
          edge: null,
          terminal: true,
        },
      ],
      branch: null,
      facts: this.facts(prefs),
      table: {
        columns: [t('table.field'), t('table.order'), t('table.whenPresent')],
        rows: HEADLINE_FIELDS.filter((field) => prefs.fields[field]).map((field) => this.row(field, prefs)),
      },
      warnings,
      links: [
        { label: t('links.preferences'), icon: 'sliders-horizontal', url: PREFERENCES_PAGE },
        { label: t('links.providers'), icon: 'tag', url: '/settings/metadata/providers' },
      ],
    };
  }

  private providers(prefs: MetadataFetchPreferences): Set<string> {
    const names = new Set<string>();
    for (const field of ALL_METADATA_FIELDS) for (const provider of prefs.fields[field]?.providers ?? []) names.add(provider);
    return names;
  }

  private facts(prefs: MetadataFetchPreferences): SetupText[] {
    const facts: SetupText[] = [];
    const genres = prefs.options?.genres;
    if (genres) facts.push(genres.mode === 'merge' ? t('facts.genresMerged') : t('facts.genresFirst'));
    if (genres?.blocklist.length) facts.push(t('facts.genresBlocked', { count: genres.blocklist.length }));
    facts.push(prefs.options?.saveProviderIds ? t('facts.idsSaved') : t('facts.idsNotSaved'));
    return facts;
  }

  private row(field: MetadataField, prefs: MetadataFetchPreferences): SetupCell[] {
    const preference = prefs.fields[field];
    const order = preference?.providers ?? [];
    return [
      { text: fieldLabel(field) },
      { text: order.length > 0 ? setupRaw(order.map(providerName).join(' · ')) : t('cells.noProvider'), dim: true },
      { text: preference?.enabled ? t(`cells.strategy.${preference.mergeStrategy}`) : t('cells.notFetched') },
    ];
  }

  private warnings(prefs: MetadataFetchPreferences): SetupWarning[] {
    const empty = ALL_METADATA_FIELDS.filter((field) => prefs.fields[field]?.enabled && (prefs.fields[field]?.providers.length ?? 0) === 0);
    if (empty.length === 0) return [];
    return [
      {
        code: 'field_without_provider',
        subject: null,
        detail: t('warnings.noProvider', { count: empty.length }),
        fix: t('warnings.fix.openPreferences'),
        url: PREFERENCES_PAGE,
      },
    ];
  }
}
