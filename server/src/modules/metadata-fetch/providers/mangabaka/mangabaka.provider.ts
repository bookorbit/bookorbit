import { Injectable, Logger } from '@nestjs/common';
import { MangabakaCollectionSummary, MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { ProviderConfigService } from '../../../metadata-preferences/provider-config.service';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { IdentifiableProvider } from '../metadata-provider';
import { MetadataSearchParams } from '../metadata-search-params';
import { PROVIDER_LIMITS } from '../provider-constants';
import { normalizeMaxCandidates } from '../provider-utils';
import { MangabakaClient } from './mangabaka.client';
import { mapMangabakaSeries, mapMangabakaWork, pickBestCollection, type WorkTitleOptions } from './mangabaka.mapper';
import { extractChapterNumber, extractVolumeNumber, stripVolumeMarker, detectLanguageHint } from './mangabaka-title-utils';

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

@Injectable()
export class MangabakaProvider implements IdentifiableProvider {
  readonly key = MetadataProviderKey.MANGABAKA;
  readonly label = 'MangaBaka';
  readonly identifiable = true as const;

  private readonly logger = new Logger(MangabakaProvider.name);

  constructor(
    private readonly client: MangabakaClient,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  async search(params: MetadataSearchParams): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.mangabaka);
    if (!enabled) return [];

    if (!params.title && !params.author) return [];

    const cleanTitle = params.title ? stripVolumeMarker(params.title) : undefined;
    const volumeNumber = params.title ? extractVolumeNumber(params.title) : undefined;
    const chapterNumber = params.title ? extractChapterNumber(params.title) : undefined;
    const preferredLanguage = params.preferredLanguage ?? (params.title ? detectLanguageHint(params.title) : undefined);
    // Search by title only - the API matches better on clean titles.
    // Author is used for candidate ranking by the pipeline, not for the search query.
    const query = cleanTitle ?? params.author ?? '';

    if (!query) return [];

    const maxResults = normalizeMaxCandidates(params.maxCandidatesPerProvider, PROVIDER_LIMITS.MANGABAKA_MAX_RESULTS);
    const titleOptions: WorkTitleOptions = {
      richTitleFormat: params.richTitleFormat ?? true,
      includeChapter: params.includeChapter ?? false,
    };

    const startedAt = Date.now();
    this.logger.log(
      `[MangaBaka.search] [start] query="${sanitizeLogValue(query)}" volumeNumber=${volumeNumber ?? 'none'} chapterNumber=${chapterNumber ?? 'none'} resolveVolumes=${params.resolveVolumes ?? false} preferredLanguage=${preferredLanguage ?? 'auto'} - search started`,
    );

    // Prefer the stable /v1/series/search endpoint (returns full series objects).
    // Fall back to /v1/series/match (fuzzy) when search yields no candidates.
    let series = await this.client.search(query, maxResults, params.signal);
    if (series.length === 0) {
      series = await this.client.match(query, maxResults, params.signal);
    }

    const candidates: MetadataCandidate[] = [];
    for (const s of series) {
      const candidate = mapMangabakaSeries(s);
      if (candidate) candidates.push(candidate);
    }

    // Auto-fill mode: resolve from series to the matching volume work when possible.
    if (params.resolveVolumes && volumeNumber != null && candidates.length > 0) {
      const resolved = await this.resolveVolumeCandidate(candidates[0], volumeNumber, chapterNumber, titleOptions, preferredLanguage, params.signal);
      if (resolved) {
        this.logger.log(
          `[MangaBaka.search] [end] durationMs=${Date.now() - startedAt} candidates=${candidates.length} resolvedVolume=${volumeNumber} - search completed (volume resolved)`,
        );
        return [resolved, ...candidates.slice(1)];
      }
    }

    this.logger.log(`[MangaBaka.search] [end] durationMs=${Date.now() - startedAt} candidates=${candidates.length} - search completed`);
    return candidates;
  }

  /**
   * For auto-fill: given a series candidate and a volume number, find the best
   * matching volume (work) candidate. Returns null if resolution fails, which
   * causes the caller to fall back to the series-level candidate.
   */
  private async resolveVolumeCandidate(
    seriesCandidate: MetadataCandidate,
    volumeNumber: number,
    chapterNumber: number | undefined,
    titleOptions: WorkTitleOptions,
    preferredLanguage?: string,
    signal?: AbortSignal,
  ): Promise<MetadataCandidate | null> {
    const seriesId = Number(seriesCandidate.providerId);
    if (!Number.isSafeInteger(seriesId) || seriesId <= 0) return null;

    try {
      const collections = await this.client.fetchCollections(seriesId, signal);
      if (!collections.length) return null;

      const best = pickBestCollection(collections, preferredLanguage);
      if (!best) return null;

      const series = await this.client.fetchSeries(seriesId, signal);
      if (!series) return null;

      const works = await this.client.fetchWorks(best.id, signal);
      const mainWorks = works.filter((w) => w.count_type === 'main');

      const match = mainWorks.find((w) => w.sequence_numeric === volumeNumber);
      if (!match) return null;

      const candidate = mapMangabakaWork(match, series, chapterNumber, titleOptions, preferredLanguage);
      return candidate;
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      const errorClass = err instanceof Error ? err.constructor.name : 'Unknown';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[MangaBaka.resolveVolume] [fail] seriesId=${seriesId} volumeNumber=${volumeNumber} errorClass=${errorClass} error="${sanitizeLogValue(errorMessage)}" - volume resolution failed, falling back to series`,
      );
      return null;
    }
  }

  async fetchSeriesCollections(seriesId: number, signal?: AbortSignal): Promise<MangabakaCollectionSummary[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.mangabaka);
    if (!enabled) return [];

    const startedAt = Date.now();
    this.logger.log(`[MangaBaka.fetch_collections] [start] seriesId=${seriesId} - fetch collections started`);

    try {
      const collections = await this.client.fetchCollections(seriesId, signal);
      const filtered = collections.filter((c) => c.count_main > 0);
      const summaries: MangabakaCollectionSummary[] = filtered.map((c) => ({
        id: c.id,
        title: c.title,
        language: c.language?.iso ?? '',
        languageDisplay: c.language?.language ?? '',
        publisher: c.publisher?.name ?? '',
        medium: c.medium,
        type: c.type,
        countMain: c.count_main,
        countExtra: c.count_extra,
        countOther: c.count_other,
      }));
      this.logger.log(
        `[MangaBaka.fetch_collections] [end] seriesId=${seriesId} durationMs=${Date.now() - startedAt} total=${collections.length} filtered=${summaries.length} - fetch collections completed`,
      );
      return summaries;
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.warn(
        `[MangaBaka.fetch_collections] [fail] seriesId=${seriesId} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.constructor.name : 'Unknown'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - fetch collections failed`,
      );
      return [];
    }
  }

  async fetchCollectionWorks(collectionId: string, seriesId: number, preferredLanguage?: string, signal?: AbortSignal): Promise<MetadataCandidate[]> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.mangabaka);
    if (!enabled) return [];

    const startedAt = Date.now();
    this.logger.log(
      `[MangaBaka.fetch_collection_works] [start] collectionId="${sanitizeLogValue(collectionId)}" seriesId=${seriesId} - fetch collection works started`,
    );

    try {
      const series = await this.client.fetchSeries(seriesId, signal);
      if (!series) {
        this.logger.log(
          `[MangaBaka.fetch_collection_works] [end] collectionId="${sanitizeLogValue(collectionId)}" seriesId=${seriesId} durationMs=${Date.now() - startedAt} candidates=0 - series not found`,
        );
        return [];
      }

      const works = await this.client.fetchWorks(collectionId, signal);
      const mainWorks = works.filter((w) => w.count_type === 'main');
      const candidates: MetadataCandidate[] = [];
      for (const work of mainWorks) {
        const candidate = mapMangabakaWork(work, series, undefined, undefined, preferredLanguage);
        if (candidate) candidates.push(candidate);
      }
      this.logger.log(
        `[MangaBaka.fetch_collection_works] [end] collectionId="${sanitizeLogValue(collectionId)}" seriesId=${seriesId} durationMs=${Date.now() - startedAt} works=${works.length} mainWorks=${mainWorks.length} candidates=${candidates.length} - fetch collection works completed`,
      );
      return candidates;
    } catch (err) {
      if (err instanceof ProviderThrottleError) throw err;
      this.logger.warn(
        `[MangaBaka.fetch_collection_works] [fail] collectionId="${sanitizeLogValue(collectionId)}" seriesId=${seriesId} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.constructor.name : 'Unknown'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - fetch collection works failed`,
      );
      return [];
    }
  }

  async lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null> {
    const { enabled } = await this.providerConfig.getConfig().then((c) => c.mangabaka);
    if (!enabled) return null;

    const startedAt = Date.now();

    if (UUID_RE.test(providerId)) {
      this.logger.log(`[MangaBaka.lookupById] [start] providerId="${sanitizeLogValue(providerId)}" mode=work - lookup started`);
      const work = await this.client.fetchWork(providerId, signal);
      if (!work) {
        this.logger.log(`[MangaBaka.lookupById] [end] durationMs=${Date.now() - startedAt} found=false - lookup completed (work not found)`);
        return null;
      }
      const series = await this.client.fetchSeries(work.series_id, signal);
      if (!series) {
        this.logger.log(`[MangaBaka.lookupById] [end] durationMs=${Date.now() - startedAt} found=false - lookup completed (series not found)`);
        return null;
      }
      const candidate = mapMangabakaWork(work, series);
      this.logger.log(`[MangaBaka.lookupById] [end] durationMs=${Date.now() - startedAt} found=${candidate !== null} - lookup completed (work)`);
      return candidate;
    }

    // Fallback: treat as a numeric series ID for backwards compatibility.
    if (/^\d+$/.test(providerId) && Number.isSafeInteger(Number(providerId))) {
      this.logger.log(`[MangaBaka.lookupById] [start] providerId="${sanitizeLogValue(providerId)}" mode=series - lookup started`);
      const series = await this.client.fetchSeries(Number(providerId), signal);
      if (!series) {
        this.logger.log(`[MangaBaka.lookupById] [end] durationMs=${Date.now() - startedAt} found=false - lookup completed (series not found)`);
        return null;
      }
      const candidate = mapMangabakaSeries(series);
      this.logger.log(`[MangaBaka.lookupById] [end] durationMs=${Date.now() - startedAt} found=${candidate !== null} - lookup completed (series)`);
      return candidate;
    }

    this.logger.warn(
      `[MangaBaka.lookupById] [fail] providerId="${sanitizeLogValue(providerId)}" errorClass=ValidationError error="invalid id format" - lookup failed`,
    );
    return null;
  }
}
