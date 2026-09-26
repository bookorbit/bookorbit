import { Injectable, Logger } from '@nestjs/common';
import {
  AudiobookChapter,
  BookCommunityRating,
  ComicMetadataFields,
  CoverMedia,
  CoverMedium,
  FieldPreference,
  MetadataCandidate,
  MetadataFetchCoverSlotDiagnostics,
  MetadataFetchDiagnostics,
  MetadataFetchPreferences,
  MetadataField,
  MetadataMergeStrategy,
  MetadataProviderKey,
  MetadataSeriesMembership,
  MIN_COVER_SHORT_SIDE_PX,
  ProviderConfigurations,
  parseSeriesIndex,
} from '@bookorbit/types';
import { firstValueFrom, toArray } from 'rxjs';

import { MetadataPreferenceResolver } from '../metadata-preferences/metadata-preference-resolver';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { MetadataPreferencesService } from '../metadata-preferences/metadata-preferences.service';
import { SeriesExpectedCountService } from '../../common/services/series-expected-count.service';
import { applyGenreFetchOptions, createGenreBlocklistTokenSet, mergeExistingGenres } from '../../common/utils/genre-fetch-options.utils';
import { normalizeMetadataText, normalizeMetadataTextKey } from '../../common/utils/metadata-text-normalize.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { acceptAgainstAnchor, resolveCandidateAgreement } from './candidate-agreement';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { ProviderThrottleTracker } from './provider-throttle.tracker';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { extractChapterNumber } from './providers/mangabaka/mangabaka-title-utils';

/**
 * One fetched cover a slot may take, in the order the apply step tries them. `fit` compares the
 * shape the provider stated with the slot's: a `mismatch` only ever fills an empty slot.
 */
export interface ResolvedCoverChoice {
  url: string;
  provider: MetadataProviderKey;
  fit: 'match' | 'unknown' | 'mismatch';
}

export type ResolvedMetadataFields = Partial<Record<MetadataField, string | string[] | number | null>> & {
  /** The ebook slot's first choice. */
  coverUrl?: string;
  coverChoices?: ResolvedCoverChoice[];
  /** The audio slot's first choice. */
  audioCoverUrl?: string;
  audioCoverChoices?: ResolvedCoverChoice[];
  hardcoverEditionId?: string | null;
  publishedDate?: string | null;
  seriesMemberships?: MetadataSeriesMembership[];
  chapters?: AudiobookChapter[];
  comicMetadata?: ComicMetadataFields;
  communityRatings?: BookCommunityRating[];
  mangabakaSeriesId?: string | null;
};

/** `cover` is the ebook slot and `audioCover` the audio slot; each is present when its slot is filled. */
export interface ExistingMetadataFields extends Partial<Record<MetadataField, unknown>> {
  chapters?: unknown;
  comicMetadata?: Partial<Record<keyof ComicMetadataFields, unknown>> | null;
  hardcoverEditionId?: unknown;
}

export interface MetadataFetchRunOptions {
  preserveExisting?: boolean;
  /**
   * The book's cover media (`getCoverMedia`). They decide which cover rules run, which providers are
   * worth asking, and whether a second pass fetches the other medium's art. Flows without a stored
   * book omit it and count as the one medium `isAudiobook` names.
   */
  coverMedia?: CoverMedia;
  /** Cover slots whose lock is set. A locked slot is neither resolved nor searched for. */
  lockedCoverSlots?: readonly CoverMedium[];
}

type ResolvedProviderIds = Partial<Record<MetadataProviderKey, string>>;
type CandidatesByProvider = Map<string, MetadataCandidate>;

const COVER_FIELD_BY_MEDIUM: Record<CoverMedium, 'cover' | 'audioCover'> = { ebook: 'cover', audio: 'audioCover' };
const EXPECTED_SHAPE: Record<CoverMedium, 'portrait' | 'square'> = { ebook: 'portrait', audio: 'square' };
// The apply step downloads at most three; the rest only cover choices it had to skip.
const MAX_COVER_CHOICES = 5;
// An audiobook source's id is worth keeping even when it only supplied art: the next fetch of the
// audio slot is then a direct lookup instead of a search.
const COVER_ONLY_SAVED_ID_PROVIDERS = new Set<MetadataProviderKey>([
  MetadataProviderKey.AUDIBLE,
  MetadataProviderKey.AUDNEXUS,
  MetadataProviderKey.LIBROFM,
]);

interface FetchScope {
  media: CoverMedia;
  primaryMedium: CoverMedium;
  lockedSlots: ReadonlySet<CoverMedium>;
}

interface CoverSlotResolution {
  choices: ResolvedCoverChoice[];
  pass: 1 | 2;
}

type ProviderSelectionDiagnostics = Pick<
  MetadataFetchDiagnostics,
  'activeProviders' | 'fieldRuleProviders' | 'disabledFieldRuleProviders' | 'enabledUnreferencedProviders' | 'throttledProviders'
> & {
  missingExistingProviderIdCount: number;
};

type ConfiguredProviderSelection = Pick<
  MetadataFetchDiagnostics,
  'fieldRuleProviders' | 'disabledFieldRuleProviders' | 'enabledUnreferencedProviders'
> & {
  configuredFieldRuleProviders: MetadataProviderKey[];
};

type ProviderPreferenceContext = {
  preferences: MetadataFetchPreferences;
  registeredKeys: MetadataProviderKey[];
  providerConfig: ProviderConfigurations;
};

@Injectable()
export class MetadataFetchPipeline {
  private readonly logger = new Logger(MetadataFetchPipeline.name);

  constructor(
    private readonly fetchService: MetadataFetchService,
    private readonly preferencesService: MetadataPreferencesService,
    private readonly resolver: MetadataPreferenceResolver,
    private readonly registry: ProviderRegistry,
    private readonly throttleTracker: ProviderThrottleTracker,
    private readonly providerConfig: ProviderConfigService,
    private readonly seriesExpectedCount: SeriesExpectedCountService,
  ) {}

  async run(
    params: MetadataSearchParams,
    existingFields: ExistingMetadataFields,
    libraryId?: number,
    options?: MetadataFetchRunOptions,
  ): Promise<ResolvedMetadataFields> {
    const { resolved } = await this.runInternal(params, existingFields, libraryId, options);
    return resolved;
  }

  async runWithSources(
    params: MetadataSearchParams,
    existingFields: ExistingMetadataFields,
    libraryId?: number,
    options?: MetadataFetchRunOptions,
  ): Promise<{
    resolved: ResolvedMetadataFields;
    sources: Record<string, string>;
    providerIds: ResolvedProviderIds;
    diagnostics: MetadataFetchDiagnostics;
  }> {
    return this.runInternal(params, existingFields, libraryId, options);
  }

  /** The providers the field rules would query, narrowed to a book's media when one is given. */
  async getEffectiveProviderKeys(libraryId?: number, media?: CoverMedia): Promise<MetadataProviderKey[]> {
    const { preferences, registeredKeys, providerConfig } = await this.resolveProviderPreferenceContext(libraryId);
    return this.deriveConfiguredProviderSelection(preferences, registeredKeys, providerConfig, media).configuredFieldRuleProviders;
  }

  private async runInternal(
    params: MetadataSearchParams,
    existingFields: ExistingMetadataFields,
    libraryId?: number,
    options?: MetadataFetchRunOptions,
  ): Promise<{
    resolved: ResolvedMetadataFields;
    sources: Record<string, string>;
    providerIds: ResolvedProviderIds;
    diagnostics: MetadataFetchDiagnostics;
  }> {
    const { preferences, registeredKeys, providerConfig } = await this.resolveProviderPreferenceContext(libraryId);
    const scope = this.fetchScope(params, options);
    const existingProviderIdsOnly = preferences.options?.providerIdMode === 'existingOnly' && params.existingProviderIds !== undefined;
    const providerSelection = this.deriveProviderSet(
      preferences,
      registeredKeys,
      providerConfig,
      scope.media,
      existingProviderIdsOnly ? params.existingProviderIds : undefined,
    );
    const coverOnlyProviders = this.coverOnlyProviders(preferences, scope.media, providerSelection.activeProviders);
    const providerSearchParams = existingProviderIdsOnly ? { ...params, existingProviderIdsOnly: true } : params;
    const searchParams = providerSelection.activeProviders.some((provider) => this.registry.servesOnlyAudiobooks(provider))
      ? { ...providerSearchParams, includeAudiobookProviders: true }
      : providerSearchParams;
    // Thread rich title format preference and chapter inclusion flag for MangaBaka.
    if (preferences.options?.richTitleFormat !== undefined) {
      (searchParams as MetadataSearchParams).richTitleFormat = preferences.options.richTitleFormat;
    }
    // Include chapter in MangaBaka title when the query contains a chapter marker.
    if (params.title && extractChapterNumber(params.title) !== undefined) {
      (searchParams as MetadataSearchParams).includeChapter = true;
    }
    const candidates = await this.searchCandidates(searchParams, providerSelection.activeProviders);

    // The service already swallows its own failures; this guards the invariant at the boundary so
    // that a future change there can never turn a series total into a failed metadata refresh.
    await this.seriesExpectedCount.recordFromCandidates(candidates).catch((err: Error) => {
      this.logger.warn(`[metadata.seriesTotals] [fail] errorClass=${err.name} - series totals not recorded; resolution continues`);
    });

    const { anchor, accepted: agreeing } = this.rejectDisagreeingCandidates(
      preferences,
      providerSelection.activeProviders,
      this.firstPerProvider(candidates),
      params,
      coverOnlyProviders,
    );
    const { resolved, sources, providerIds } = this.applyPreferences(
      preferences,
      agreeing,
      existingFields,
      params.existingProviderIds,
      options,
      coverOnlyProviders,
    );

    const coverSlots: Partial<Record<CoverMedium, MetadataFetchCoverSlotDiagnostics>> = {};
    const primary = this.resolveCoverSlotForMedium(preferences, scope, scope.primaryMedium, agreeing, existingFields, options, 1);
    if (primary) this.applyCoverSlot(resolved, sources, scope.primaryMedium, primary, coverSlots);

    const otherMedium: CoverMedium = scope.primaryMedium === 'ebook' ? 'audio' : 'ebook';
    let pass2Candidates: MetadataCandidate[] = [];
    let pass2Providers: MetadataProviderKey[] = [];
    if (this.hasMedium(scope.media, otherMedium)) {
      const other = await this.resolveOtherMediumSlot(
        preferences,
        scope,
        otherMedium,
        { params: providerSearchParams, existingProviderIdsOnly, activeProviders: providerSelection.activeProviders },
        { anchor, agreeing },
        existingFields,
        options,
      );
      pass2Candidates = other.pass2Candidates;
      pass2Providers = other.pass2Providers;
      if (other.slot) this.applyCoverSlot(resolved, sources, otherMedium, other.slot, coverSlots);
    }

    for (const medium of ['ebook', 'audio'] as const) {
      if (this.coverSlotApplies(preferences, scope, medium) && !coverSlots[medium]) coverSlots[medium] = { provider: null, pass: null };
    }

    const diagnostics = this.buildDiagnostics(
      {
        ...providerSelection,
        activeProviders: [...new Set([...providerSelection.activeProviders, ...pass2Providers])],
      },
      [...agreeing.values(), ...pass2Candidates],
      resolved,
      coverSlots,
    );
    return { resolved, sources, providerIds, diagnostics };
  }

  private async searchCandidates(params: MetadataSearchParams, providers: MetadataProviderKey[]): Promise<MetadataCandidate[]> {
    if (providers.length === 0) return [];
    return firstValueFrom(this.fetchService.searchCandidates(params, providers).pipe(toArray()), { defaultValue: [] as MetadataCandidate[] });
  }

  private firstPerProvider(candidates: readonly MetadataCandidate[]): CandidatesByProvider {
    const byProvider: CandidatesByProvider = new Map();
    for (const candidate of candidates) {
      if (!byProvider.has(candidate.provider)) byProvider.set(candidate.provider, candidate);
    }
    return byProvider;
  }

  private fetchScope(params: MetadataSearchParams, options: MetadataFetchRunOptions | undefined): FetchScope {
    const stated = options?.coverMedia;
    const media = stated && (stated.hasEbook || stated.hasAudio) ? stated : { hasEbook: !params.isAudiobook, hasAudio: params.isAudiobook === true };
    let primaryMedium: CoverMedium = params.isAudiobook ? 'audio' : 'ebook';
    if (!this.hasMedium(media, primaryMedium)) primaryMedium = primaryMedium === 'ebook' ? 'audio' : 'ebook';
    return { media, primaryMedium, lockedSlots: new Set(options?.lockedCoverSlots ?? []) };
  }

  private hasMedium(media: CoverMedia, medium: CoverMedium): boolean {
    return medium === 'ebook' ? media.hasEbook : media.hasAudio;
  }

  /** A cover rule only applies to a book that has its medium. */
  private fieldApplies(field: MetadataField, media: CoverMedia): boolean {
    if (field === 'cover') return media.hasEbook;
    if (field === 'audioCover') return media.hasAudio;
    return true;
  }

  private coverSlotApplies(preferences: MetadataFetchPreferences, scope: FetchScope, medium: CoverMedium): boolean {
    const field = COVER_FIELD_BY_MEDIUM[medium];
    return this.hasMedium(scope.media, medium) && preferences.fields[field]?.enabled === true && !scope.lockedSlots.has(medium);
  }

  /**
   * Providers that only a cover rule put in play. They help decide which book this is and supply
   * that slot's art, but nothing else: an audiobook source brought in for its square art must not
   * replace a book's chapters, ids or comic data.
   */
  private coverOnlyProviders(
    preferences: MetadataFetchPreferences,
    media: CoverMedia,
    activeProviders: readonly MetadataProviderKey[],
  ): Set<MetadataProviderKey> {
    const fullRole = new Set<MetadataProviderKey>();
    for (const [field, fieldPreference] of Object.entries(preferences.fields) as [MetadataField, FieldPreference][]) {
      if (!fieldPreference.enabled || field === 'cover' || field === 'audioCover' || !this.fieldApplies(field, media)) continue;
      for (const provider of fieldPreference.providers) fullRole.add(provider);
    }
    return new Set(activeProviders.filter((provider) => !fullRole.has(provider)));
  }

  private resolveCoverSlotForMedium(
    preferences: MetadataFetchPreferences,
    scope: FetchScope,
    medium: CoverMedium,
    candidates: CandidatesByProvider,
    existingFields: ExistingMetadataFields,
    options: MetadataFetchRunOptions | undefined,
    pass: 1 | 2,
  ): CoverSlotResolution | null {
    if (!this.coverSlotApplies(preferences, scope, medium)) return null;
    const field = COVER_FIELD_BY_MEDIUM[medium];
    const fieldPreference = preferences.fields[field];
    const mergeStrategy = options?.preserveExisting ? 'fillMissing' : fieldPreference.mergeStrategy;
    const present = !this.isMissing(existingFields[field]);
    if (mergeStrategy === 'fillMissing' && present) return null;
    const choices = this.orderCoverChoices(medium, fieldPreference.providers, candidates, present);
    return choices.length > 0 ? { choices, pass } : null;
  }

  /**
   * The slot's covers in the rule's order, grouped by how well the provider's stated shape fits:
   * matching art first, then art of unknown shape, and last, only while the slot is empty, art of
   * the other shape. A wrong-shape image never replaces a cover the book already has.
   */
  private orderCoverChoices(
    medium: CoverMedium,
    providers: readonly MetadataProviderKey[],
    candidates: CandidatesByProvider,
    slotFilled: boolean,
  ): ResolvedCoverChoice[] {
    const byFit: Record<ResolvedCoverChoice['fit'], ResolvedCoverChoice[]> = { match: [], unknown: [], mismatch: [] };
    const seenUrls = new Set<string>();
    for (const provider of providers) {
      const candidate = candidates.get(provider);
      const url = candidate?.coverUrl?.trim();
      if (!candidate || !url || seenUrls.has(url) || this.isStatedTooSmall(candidate)) continue;
      seenUrls.add(url);
      const shape = candidate.coverShape ?? 'unknown';
      const fit: ResolvedCoverChoice['fit'] = shape === 'unknown' ? 'unknown' : shape === EXPECTED_SHAPE[medium] ? 'match' : 'mismatch';
      byFit[fit].push({ url, provider, fit });
    }
    return [...byFit.match, ...byFit.unknown, ...(slotFilled ? [] : byFit.mismatch)].slice(0, MAX_COVER_CHOICES);
  }

  /** A provider that states its image's size lets a thumbnail be skipped without a download. */
  private isStatedTooSmall(candidate: MetadataCandidate): boolean {
    const { coverWidth, coverHeight } = candidate;
    return typeof coverWidth === 'number' && typeof coverHeight === 'number' && Math.min(coverWidth, coverHeight) < MIN_COVER_SHORT_SIDE_PX;
  }

  private applyCoverSlot(
    resolved: ResolvedMetadataFields,
    sources: Record<string, string>,
    medium: CoverMedium,
    slot: CoverSlotResolution,
    coverSlots: Partial<Record<CoverMedium, MetadataFetchCoverSlotDiagnostics>>,
  ): void {
    const [first] = slot.choices;
    if (!first) return;
    if (medium === 'ebook') {
      resolved.coverUrl = first.url;
      resolved.coverChoices = slot.choices;
      sources.coverUrl = first.provider;
    } else {
      resolved.audioCoverUrl = first.url;
      resolved.audioCoverChoices = slot.choices;
      sources.audioCoverUrl = first.provider;
    }
    coverSlots[medium] = { provider: first.provider, pass: slot.pass };
  }

  /**
   * The slot of the medium the book was not searched as. Providers that ignore the medium already
   * answered in pass 1; iTunes and Hardcover hold a separate edition per medium, so pass 2 asks
   * them again for this one. Pass 2 searches without the ISBN and the stored iTunes id and
   * Hardcover edition, which all name the other edition, and saves no ids, since each id column is
   * shared by both media.
   */
  private async resolveOtherMediumSlot(
    preferences: MetadataFetchPreferences,
    scope: FetchScope,
    medium: CoverMedium,
    pass1: { params: MetadataSearchParams; existingProviderIdsOnly: boolean; activeProviders: readonly MetadataProviderKey[] },
    agreement: { anchor: MetadataCandidate | undefined; agreeing: CandidatesByProvider },
    existingFields: ExistingMetadataFields,
    options: MetadataFetchRunOptions | undefined,
  ): Promise<{ slot: CoverSlotResolution | null; pass2Candidates: MetadataCandidate[]; pass2Providers: MetadataProviderKey[] }> {
    const none = { slot: null, pass2Candidates: [], pass2Providers: [] };
    if (!this.coverSlotApplies(preferences, scope, medium)) return none;
    const field = COVER_FIELD_BY_MEDIUM[medium];
    const mergeStrategy = options?.preserveExisting ? 'fillMissing' : preferences.fields[field].mergeStrategy;
    if (mergeStrategy === 'fillMissing' && !this.isMissing(existingFields[field])) return none;

    const carried: CandidatesByProvider = new Map(
      [...agreement.agreeing].filter(([provider]) => !this.registry.editionFollowsMedium(provider as MetadataProviderKey)),
    );
    const pass2Providers = pass1.existingProviderIdsOnly
      ? []
      : preferences.fields[field].providers.filter(
          (provider) => pass1.activeProviders.includes(provider) && this.registry.editionFollowsMedium(provider),
        );
    if (pass2Providers.length === 0) {
      return {
        slot: this.resolveCoverSlotForMedium(preferences, scope, medium, carried, existingFields, options, 1),
        pass2Candidates: [],
        pass2Providers,
      };
    }

    const existingProviderIds = pass1.params.existingProviderIds ? { ...pass1.params.existingProviderIds } : undefined;
    if (existingProviderIds) delete existingProviderIds[MetadataProviderKey.ITUNES];
    const pass2Params: MetadataSearchParams = {
      ...pass1.params,
      isbn: undefined,
      hardcoverEditionId: undefined,
      existingProviderIds,
      isAudiobook: medium === 'audio',
      includeAudiobookProviders: false,
    };
    const found = this.firstPerProvider(await this.searchCandidates(pass2Params, pass2Providers));
    const pass2Candidates = this.acceptPass2Candidates(agreement.anchor, [...found.values()], pass2Params);
    for (const candidate of pass2Candidates) carried.set(candidate.provider, candidate);

    const slot = this.resolveCoverSlotForMedium(preferences, scope, medium, carried, existingFields, options, 1);
    if (slot && pass2Candidates.some((candidate) => candidate.provider === slot.choices[0]?.provider)) slot.pass = 2;
    return { slot, pass2Candidates, pass2Providers };
  }

  private acceptPass2Candidates(
    anchor: MetadataCandidate | undefined,
    candidates: MetadataCandidate[],
    params: MetadataSearchParams,
  ): MetadataCandidate[] {
    const { accepted, rejected } = anchor ? acceptAgainstAnchor(anchor, candidates) : resolveCandidateAgreement(candidates, params);
    if (rejected.length > 0) {
      this.logger.warn(
        `[metadata_fetch.candidate_agreement] [end] pass=2 anchorProvider=${anchor?.provider ?? 'none'} acceptedCount=${accepted.length} rejectedProviders=${rejected.map((candidate) => candidate.provider).join('|')} anchorTitle="${sanitizeLogValue(anchor?.title ?? '')}" rejectedTitles="${sanitizeLogValue(rejected.map((candidate) => candidate.title ?? '').join('|'))}" - other-medium candidates describing a different book were dropped`,
      );
    }
    return accepted;
  }

  /**
   * Drops candidates that describe a different book from the anchor, before field rules get to
   * source individual fields from them. Without this, every provider that matched the wrong book
   * still contributes whichever fields it ranks first for, and the result is one record assembled
   * out of several books. Cover-only providers are held to the anchor but never pick it, unless no
   * other provider found anything.
   */
  private rejectDisagreeingCandidates(
    preferences: MetadataFetchPreferences,
    activeProviders: readonly MetadataProviderKey[],
    byProvider: ReadonlyMap<string, MetadataCandidate>,
    params: MetadataSearchParams,
    coverOnlyProviders: ReadonlySet<MetadataProviderKey>,
  ): { anchor: MetadataCandidate | undefined; accepted: CandidatesByProvider } {
    const ordered = this.orderByIdentityTrust(preferences, activeProviders, byProvider);
    const identifying = ordered.filter((candidate) => !coverOnlyProviders.has(candidate.provider));
    const coverOnly = ordered.filter((candidate) => coverOnlyProviders.has(candidate.provider));
    const agreement = resolveCandidateAgreement(identifying.length > 0 ? identifying : coverOnly, params);
    const accepted = [...agreement.accepted];
    const rejected = [...agreement.rejected];
    if (identifying.length > 0 && coverOnly.length > 0) {
      if (agreement.anchor) {
        const checked = acceptAgainstAnchor(agreement.anchor, coverOnly);
        accepted.push(...checked.accepted);
        rejected.push(...checked.rejected);
      } else {
        accepted.push(...coverOnly);
      }
    }

    if (rejected.length > 0) {
      this.logger.warn(
        `[metadata_fetch.candidate_agreement] [end] anchorProvider=${agreement.anchor?.provider ?? 'none'} acceptedCount=${accepted.length} rejectedProviders=${rejected.map((candidate) => candidate.provider).join('|')} anchorTitle="${sanitizeLogValue(agreement.anchor?.title ?? '')}" rejectedTitles="${sanitizeLogValue(rejected.map((candidate) => candidate.title ?? '').join('|'))}" - candidates describing a different book were dropped`,
      );
    }

    return { anchor: agreement.anchor, accepted: new Map(accepted.map((candidate) => [candidate.provider, candidate])) };
  }

  /**
   * Candidates ordered by how far each provider is trusted to establish which book this is. The
   * title rule leads because that is where the user declares that authority; arrival order cannot
   * be used, since providers resolve as a race.
   */
  private orderByIdentityTrust(
    preferences: MetadataFetchPreferences,
    activeProviders: readonly MetadataProviderKey[],
    byProvider: ReadonlyMap<string, MetadataCandidate>,
  ): MetadataCandidate[] {
    const ordered: MetadataCandidate[] = [];
    const seen = new Set<string>();

    for (const providerKey of [...(preferences.fields.title?.providers ?? []), ...activeProviders, ...byProvider.keys()]) {
      if (seen.has(providerKey)) continue;
      seen.add(providerKey);

      const candidate = byProvider.get(providerKey);
      if (candidate) ordered.push(candidate);
    }

    return ordered;
  }

  private async resolveProviderPreferenceContext(libraryId?: number): Promise<ProviderPreferenceContext> {
    const [global, providerConfig] = await Promise.all([this.preferencesService.getGlobal(), this.providerConfig.getConfig()]);
    const overrides = libraryId ? (await this.preferencesService.getForLibrary(libraryId, global)).overrides : null;
    const registeredKeys = this.registry.all().map((p) => p.key) as MetadataProviderKey[];
    const preferences: MetadataFetchPreferences = this.resolver.withForwardCompatibility(this.resolver.resolve(global, overrides), registeredKeys);

    return { preferences, registeredKeys, providerConfig };
  }

  /**
   * Field-rule providers, narrowed to what can answer for the book's media when they are known: an
   * audiobook source is neither queried for nor reported missing from a book without audio, and a
   * cover rule for a medium the book lacks contributes nothing.
   */
  private deriveConfiguredProviderSelection(
    preferences: MetadataFetchPreferences,
    registeredKeys: MetadataProviderKey[],
    providerConfig: ProviderConfigurations,
    media?: CoverMedia,
  ): ConfiguredProviderSelection {
    const eligible = new Set(media ? this.registry.keysForMedia(registeredKeys, media) : registeredKeys);
    const fieldRuleProviders = new Set<MetadataProviderKey>();
    const configuredFieldRuleProviders = new Set<MetadataProviderKey>();
    const disabledFieldRuleProviders = new Set<MetadataProviderKey>();

    for (const [field, fieldPreference] of Object.entries(preferences.fields) as [MetadataField, FieldPreference][]) {
      if (!fieldPreference.enabled) continue;
      if (media && !this.fieldApplies(field, media)) continue;
      for (const providerKey of fieldPreference.providers) {
        if (!eligible.has(providerKey)) continue;
        fieldRuleProviders.add(providerKey);
        if (providerConfig[providerKey]?.enabled === false) {
          disabledFieldRuleProviders.add(providerKey);
        } else {
          configuredFieldRuleProviders.add(providerKey);
        }
      }
    }

    const enabledUnreferencedProviders = [...eligible].filter(
      (providerKey) => providerConfig[providerKey]?.enabled !== false && !fieldRuleProviders.has(providerKey),
    );

    return {
      fieldRuleProviders: [...fieldRuleProviders],
      configuredFieldRuleProviders: [...configuredFieldRuleProviders],
      disabledFieldRuleProviders: [...disabledFieldRuleProviders],
      enabledUnreferencedProviders,
    };
  }

  private deriveProviderSet(
    preferences: MetadataFetchPreferences,
    registeredKeys: MetadataProviderKey[],
    providerConfig: ProviderConfigurations,
    media: CoverMedia,
    requiredProviderIds?: Partial<Record<MetadataProviderKey, string>>,
  ): ProviderSelectionDiagnostics {
    const configuredProviderSelection = this.deriveConfiguredProviderSelection(preferences, registeredKeys, providerConfig, media);

    const activeProviders: MetadataProviderKey[] = [];
    const throttledProviders: MetadataProviderKey[] = [];
    let missingExistingProviderIdCount = 0;
    for (const key of configuredProviderSelection.configuredFieldRuleProviders) {
      if (requiredProviderIds && !this.hasExistingProviderIdentity(key, requiredProviderIds)) {
        missingExistingProviderIdCount += 1;
        continue;
      }
      if (this.throttleTracker.isThrottled(key)) {
        throttledProviders.push(key);
        this.logger.warn(
          `[metadata_fetch.pipeline_provider] [fail] provider=${key} durationMs=0 errorClass=ProviderThrottleError error="provider is in cooldown" - provider skipped`,
        );
      } else {
        activeProviders.push(key);
      }
    }

    return {
      activeProviders,
      fieldRuleProviders: configuredProviderSelection.fieldRuleProviders,
      disabledFieldRuleProviders: configuredProviderSelection.disabledFieldRuleProviders,
      enabledUnreferencedProviders: configuredProviderSelection.enabledUnreferencedProviders,
      throttledProviders,
      missingExistingProviderIdCount,
    };
  }

  private hasExistingProviderIdentity(provider: MetadataProviderKey, providerIds: Partial<Record<MetadataProviderKey, string>>): boolean {
    const identityProvider = provider === MetadataProviderKey.AUDNEXUS ? MetadataProviderKey.AUDIBLE : provider;
    return Boolean(providerIds[identityProvider]);
  }

  private buildDiagnostics(
    providerSelection: ProviderSelectionDiagnostics,
    candidates: MetadataCandidate[],
    resolved: ResolvedMetadataFields,
    coverSlots: Partial<Record<CoverMedium, MetadataFetchCoverSlotDiagnostics>>,
  ): MetadataFetchDiagnostics {
    const candidateProviders = [...new Set(candidates.map((candidate) => candidate.provider))];
    const resolvedFieldCount = Object.keys(resolved).filter((key) => key !== 'coverChoices' && key !== 'audioCoverChoices').length;
    const { missingExistingProviderIdCount, ...diagnosticProviderSelection } = providerSelection;

    let reason: MetadataFetchDiagnostics['reason'] = null;
    if (resolvedFieldCount === 0) {
      if (providerSelection.activeProviders.length === 0) {
        if (providerSelection.throttledProviders.length > 0) reason = 'providers_throttled';
        else if (missingExistingProviderIdCount > 0) reason = 'no_existing_provider_ids';
        else reason = 'no_active_providers';
      } else if (candidates.length === 0) {
        reason = 'no_candidates';
      } else {
        reason = 'no_resolved_fields';
      }
    }

    return {
      ...diagnosticProviderSelection,
      candidateProviders,
      candidateCount: candidates.length,
      resolvedFieldCount,
      reason,
      coverSlots,
    };
  }

  private applyPreferences(
    preferences: MetadataFetchPreferences,
    byProvider: Map<string, MetadataCandidate>,
    existing: ExistingMetadataFields,
    existingProviderIds: Partial<Record<MetadataProviderKey, string>> | undefined,
    options: MetadataFetchRunOptions | undefined,
    coverOnlyProviders: ReadonlySet<MetadataProviderKey>,
  ): { resolved: ResolvedMetadataFields; sources: Record<string, string>; providerIds: ResolvedProviderIds } {
    const result: ResolvedMetadataFields = {};
    const sources: Record<string, string> = {};
    const genreOptions = preferences.options?.genres;
    const blockedGenreTokens = createGenreBlocklistTokenSet(genreOptions?.blocklist);
    const identifying = new Map([...byProvider].filter(([provider]) => !coverOnlyProviders.has(provider as MetadataProviderKey)));

    for (const field of Object.keys(preferences.fields) as MetadataField[]) {
      const fieldPreference = preferences.fields[field];
      if (!fieldPreference.enabled) continue;
      // Each cover slot resolves separately, with its own shape preference and fallbacks.
      if (field === 'cover' || field === 'audioCover') continue;
      const mergeStrategy = options?.preserveExisting ? 'fillMissing' : fieldPreference.mergeStrategy;

      if (field === 'genres' && preferences.options?.genres.mode === 'merge') {
        const { genres, sourceProvider } = this.mergeGenres(
          fieldPreference.providers as MetadataProviderKey[],
          byProvider,
          blockedGenreTokens,
          genreOptions?.maxCount,
        );
        if (!genres.length) continue;

        const resolvedGenres = this.resolveGenreWrite(genres, existing[field], mergeStrategy, genreOptions?.maxCount);
        if (resolvedGenres) {
          result.genres = resolvedGenres;
          if (sourceProvider) sources.genres = sourceProvider;
        }
        continue;
      }

      if (field === 'communityRating') {
        const existingValue = existing[field];
        if (mergeStrategy === 'fillMissing' && !this.isMissing(existingValue)) continue;

        const communityRatings = this.collectCommunityRatings(fieldPreference.providers as MetadataProviderKey[], byProvider);
        if (communityRatings.length > 0) {
          result.communityRatings = communityRatings;
          sources.communityRating = communityRatings.map((rating) => rating.provider).join('|');
        }
        continue;
      }

      for (const providerKey of fieldPreference.providers) {
        const candidate = byProvider.get(providerKey);
        if (!candidate) continue;

        const value = this.extractField(candidate, field);
        if (value === undefined || value === null) continue;
        if (mergeStrategy !== 'overwrite' && this.isEmptyProviderValue(value)) continue;

        if (field === 'genres') {
          if (!Array.isArray(value)) continue;
          const genres = applyGenreFetchOptions(value, blockedGenreTokens, genreOptions?.maxCount);
          if (!genres.length) continue;
          const resolvedGenres = this.resolveGenreWrite(genres, existing[field], mergeStrategy, genreOptions?.maxCount);
          if (resolvedGenres) {
            result.genres = resolvedGenres;
            sources.genres = providerKey;
          }
          break;
        }

        const existingValue = existing[field];
        switch (mergeStrategy) {
          case 'fillMissing':
            if (this.isMissing(existingValue)) {
              (result as Record<string, unknown>)[field] = value;
              this.copyPublishedDateForYear(result, candidate, field);
              sources[field] = providerKey;
            }
            break;
          case 'overwrite':
          case 'overwriteIfProvided':
            (result as Record<string, unknown>)[field] = value;
            this.copyPublishedDateForYear(result, candidate, field);
            sources[field] = providerKey;
            break;
          case 'mergeExisting':
            break;
        }
        break;
      }
    }

    const seriesMemberships = this.resolveSeriesMemberships(byProvider, result, sources);
    if (seriesMemberships) result.seriesMemberships = seriesMemberships;

    const providerIds: ResolvedProviderIds = {};
    if (preferences.options?.saveProviderIds) {
      for (const candidate of byProvider.values()) {
        if (coverOnlyProviders.has(candidate.provider) && !COVER_ONLY_SAVED_ID_PROVIDERS.has(candidate.provider)) continue;
        const providerIdKey = candidate.provider === MetadataProviderKey.AUDNEXUS ? MetadataProviderKey.AUDIBLE : candidate.provider;
        const providerId = candidate.provider === MetadataProviderKey.AUDNEXUS ? (candidate.audibleId ?? candidate.providerId) : candidate.providerId;
        if (providerId && (!options?.preserveExisting || !existingProviderIds?.[providerIdKey])) {
          providerIds[providerIdKey] = providerId;
        }
        if (
          candidate.provider === MetadataProviderKey.HARDCOVER &&
          candidate.hardcoverEditionId &&
          (!options?.preserveExisting || this.isMissing(existing.hardcoverEditionId))
        ) {
          result.hardcoverEditionId = candidate.hardcoverEditionId;
        }
        if (
          candidate.provider === MetadataProviderKey.MANGABAKA &&
          candidate.mangabakaSeriesId &&
          (!options?.preserveExisting || this.isMissing((existing as Record<string, unknown>).mangabakaSeriesId))
        ) {
          (result as Record<string, unknown>).mangabakaSeriesId = candidate.mangabakaSeriesId;
        }
      }
    }

    // Pass through chapters from the first candidate that has them, using the
    // narrators field's provider preference order as the authority for audiobook data.
    const narratorProviders = preferences.fields['narrators']?.providers ?? [];
    const chapterProviders = [...narratorProviders, ...identifying.keys()];
    for (const providerKey of chapterProviders) {
      const candidate = identifying.get(providerKey);
      if (candidate?.chapters?.length && (!options?.preserveExisting || this.isMissing(existing.chapters))) {
        result.chapters = candidate.chapters;
        break;
      }
    }

    const comicMetadata = this.resolveComicMetadata(preferences, identifying);
    const filteredComicMetadata = options?.preserveExisting ? this.filterExistingComicMetadata(comicMetadata, existing.comicMetadata) : comicMetadata;
    if (filteredComicMetadata) result.comicMetadata = filteredComicMetadata;

    return { resolved: result, sources, providerIds };
  }

  private extractField(candidate: MetadataCandidate, field: MetadataField): unknown {
    const map: Partial<Record<MetadataField, keyof MetadataCandidate>> = {
      title: 'title',
      subtitle: 'subtitle',
      description: 'description',
      authors: 'authors',
      publisher: 'publisher',
      publishedYear: 'publishedYear',
      language: 'language',
      pageCount: 'pageCount',
      seriesName: 'seriesName',
      seriesIndex: 'seriesIndex',
      genres: 'genres',
      narrators: 'narrators',
      duration: 'durationSeconds',
      abridged: 'abridged',
    };
    const key = map[field];
    return key ? candidate[key] : undefined;
  }

  private copyPublishedDateForYear(result: ResolvedMetadataFields, candidate: MetadataCandidate, field: MetadataField): void {
    if (field === 'publishedYear' && candidate.publishedDate !== undefined) {
      result.publishedDate = candidate.publishedDate;
    }
  }

  private collectCommunityRatings(providerKeys: MetadataProviderKey[], byProvider: Map<string, MetadataCandidate>): BookCommunityRating[] {
    const updatedAt = new Date().toISOString();
    const ratings: BookCommunityRating[] = [];
    const seen = new Set<MetadataProviderKey>();

    for (const providerKey of providerKeys) {
      if (seen.has(providerKey)) continue;
      seen.add(providerKey);

      const candidate = byProvider.get(providerKey);
      if (!candidate) continue;

      const rating = this.normalizeCommunityRating(candidate.communityRating);
      if (rating === undefined) continue;

      ratings.push({
        provider: providerKey,
        rating,
        ratingCount: this.normalizeCommunityRatingCount(candidate.communityRatingCount) ?? null,
        updatedAt,
      });
    }

    return ratings;
  }

  private normalizeCommunityRating(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
  }

  private normalizeCommunityRatingCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
  }

  private resolveSeriesMemberships(
    byProvider: Map<string, MetadataCandidate>,
    resolved: ResolvedMetadataFields,
    sources: Record<string, string>,
  ): MetadataSeriesMembership[] | undefined {
    const seriesProvider = sources.seriesName as MetadataProviderKey | undefined;
    if (!seriesProvider || resolved.seriesName === undefined) return undefined;

    const memberships = this.normalizeSeriesMemberships(byProvider.get(seriesProvider)?.seriesMemberships);
    if (!memberships.length) return undefined;

    const indexProvider = sources.seriesIndex as MetadataProviderKey | undefined;
    if (indexProvider !== seriesProvider || resolved.seriesIndex === undefined) return undefined;
    return memberships;
  }

  private normalizeSeriesMemberships(memberships: readonly MetadataSeriesMembership[] | undefined): MetadataSeriesMembership[] {
    if (!memberships?.length) return [];

    const normalized: MetadataSeriesMembership[] = [];
    const seen = new Set<string>();
    for (const membership of memberships) {
      const seriesName = normalizeMetadataText(membership.seriesName);
      const key = normalizeMetadataTextKey(seriesName);
      if (!seriesName || !key || seen.has(key)) continue;

      const seriesIndex = parseSeriesIndex(membership.seriesIndex);
      seen.add(key);
      normalized.push({ seriesName, seriesIndex, expectedBookCount: membership.expectedBookCount ?? undefined });
    }

    return normalized;
  }

  private mergeGenres(
    providerKeys: MetadataProviderKey[],
    byProvider: Map<string, MetadataCandidate>,
    blockedGenreTokens: ReadonlySet<string>,
    maxCount: number | null | undefined,
  ) {
    const merged: string[] = [];
    let sourceProvider: MetadataProviderKey | undefined;

    for (const providerKey of providerKeys) {
      const candidate = byProvider.get(providerKey);
      if (!candidate?.genres?.length) continue;

      const providerGenres = applyGenreFetchOptions(candidate.genres, blockedGenreTokens, null);
      if (!providerGenres.length) continue;
      if (!sourceProvider) sourceProvider = providerKey;
      merged.push(...providerGenres);
    }

    return { genres: applyGenreFetchOptions(merged, blockedGenreTokens, maxCount), sourceProvider };
  }

  private resolveGenreWrite(
    fetchedGenres: string[],
    existingValue: unknown,
    mergeStrategy: MetadataMergeStrategy,
    maxCount: number | null | undefined,
  ): string[] | undefined {
    if (mergeStrategy === 'fillMissing') return this.isMissing(existingValue) ? fetchedGenres : undefined;
    if (mergeStrategy !== 'mergeExisting') return fetchedGenres;

    const existingGenres = Array.isArray(existingValue) ? existingValue.filter((value): value is string => typeof value === 'string') : [];
    const merged = mergeExistingGenres(existingGenres, fetchedGenres, maxCount);
    return this.arraysEqual(merged, existingGenres) ? undefined : merged;
  }

  private arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private isMissing(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private isEmptyProviderValue(value: unknown): boolean {
    if (typeof value === 'string') return value.trim().length === 0;
    return Array.isArray(value) && value.length === 0;
  }

  private filterExistingComicMetadata(
    resolved: ComicMetadataFields | undefined,
    existing: Partial<Record<keyof ComicMetadataFields, unknown>> | null | undefined,
  ): ComicMetadataFields | undefined {
    if (!resolved || !existing) return resolved;

    const filtered: ComicMetadataFields = {};
    for (const [key, value] of Object.entries(resolved) as [keyof ComicMetadataFields, ComicMetadataFields[keyof ComicMetadataFields]][]) {
      if (value === undefined || !this.isMissing(existing[key])) continue;
      filtered[key] = value as never;
    }

    return this.hasComicMetadata(filtered) ? filtered : undefined;
  }

  private resolveComicMetadata(preferences: MetadataFetchPreferences, byProvider: Map<string, MetadataCandidate>): ComicMetadataFields | undefined {
    const preferredProviders = [
      ...(preferences.fields.seriesName?.providers ?? []),
      ...(preferences.fields.title?.providers ?? []),
      ...byProvider.keys(),
    ] as MetadataProviderKey[];

    const seen = new Set<MetadataProviderKey>();
    for (const providerKey of preferredProviders) {
      if (seen.has(providerKey)) continue;
      seen.add(providerKey);

      const comicMetadata = byProvider.get(providerKey)?.comicMetadata;
      if (comicMetadata && this.hasComicMetadata(comicMetadata)) return comicMetadata;
    }
    return undefined;
  }

  private hasComicMetadata(comicMetadata: ComicMetadataFields): boolean {
    const scalarFields: (keyof ComicMetadataFields)[] = ['issueNumber', 'volumeName'];
    for (const field of scalarFields) {
      const value = comicMetadata[field];
      if (typeof value === 'string' && value.trim().length > 0) return true;
    }

    const arrayFields: (keyof ComicMetadataFields)[] = [
      'storyArcs',
      'pencillers',
      'inkers',
      'colorists',
      'letterers',
      'coverArtists',
      'characters',
      'teams',
      'locations',
    ];
    for (const field of arrayFields) {
      const value = comicMetadata[field];
      if (Array.isArray(value) && value.length > 0) return true;
    }
    return false;
  }
}
