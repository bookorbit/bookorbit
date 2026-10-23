import { Injectable } from '@nestjs/common';
import {
  ALL_AUTHOR_METADATA_FIELDS,
  AuthorFieldPreference,
  AuthorMetadataCandidate,
  AuthorMetadataField,
  AuthorMetadataPreferences,
  AuthorMetadataProviderKey,
  MergeStrategy,
  MetadataCacheServedProvider,
} from '@bookorbit/types';

import type { CacheDirective } from '../../common/provider-cache/provider-cache-spec';
import { AuthorMetadataFetchService } from './metadata/author-metadata-fetch.service';
import { AuthorImageStorageError, AuthorImageStorageService } from './author-image-storage.service';
import { AuthorEnrichmentRow, AuthorsRepository } from './authors.repository';

/** How an execution used the network and the metadata cache, for provenance and pacing. */
export type AuthorEnrichmentProvenance = {
  /** Provider requests plus portrait download attempts; 0 when the cache answered everything. */
  outboundRequests: number;
  cacheServed: MetadataCacheServedProvider[];
};

type AuthorEnrichmentOutcome =
  | {
      kind: 'done';
      provider: string | null;
      descriptionUpdated: boolean;
      imageUpdated: boolean;
      fieldsUpdated: AuthorMetadataField[];
    }
  | {
      kind: 'skipped';
      reason: SkipReason;
      provider: string | null;
      descriptionUpdated: false;
      imageUpdated: false;
      fieldsUpdated: [];
    }
  | {
      kind: 'failed';
      message: string;
      provider: string | null;
      httpStatus: number | null;
      retryAfterMs: number | null;
      transient: boolean;
      descriptionUpdated: false;
      imageUpdated: false;
      fieldsUpdated: [];
    };

export type AuthorEnrichmentExecutionResult = AuthorEnrichmentOutcome & AuthorEnrichmentProvenance;

export type AuthorMatchApplyResult =
  | { kind: 'applied'; imageUpdated: boolean; fieldsUpdated: AuthorMetadataField[]; downloads: number }
  | Omit<Extract<AuthorEnrichmentOutcome, { kind: 'failed' }>, 'descriptionUpdated' | 'imageUpdated' | 'fieldsUpdated'>;

type PinnedMatch = { provider: AuthorMetadataProviderKey; providerId: string };

const AUTHOR_PROVIDER_KEYS = new Set<string>(Object.values(AuthorMetadataProviderKey));

type AuthorUpdate = Parameters<AuthorsRepository['updateAuthorById']>[1];

type SkipReason = 'author_not_found' | 'orphaned' | 'provider_disabled' | 'no_match';

/** Without a directive an execution behaves as it did before the cache: always live, no fallback. */
const LIVE_DIRECTIVE: CacheDirective = { policy: 'refresh', allowFallback: false };

const NO_PROVENANCE: AuthorEnrichmentProvenance = { outboundRequests: 0, cacheServed: [] };

@Injectable()
export class AuthorEnrichmentExecutorService {
  constructor(
    private readonly authorsRepo: AuthorsRepository,
    private readonly authorMetadataFetchService: AuthorMetadataFetchService,
    private readonly authorImageStorage: AuthorImageStorageService,
  ) {}

  async execute(
    params: { authorId: number; preferences: AuthorMetadataPreferences },
    directive: CacheDirective = LIVE_DIRECTIVE,
  ): Promise<AuthorEnrichmentExecutionResult> {
    const author = await this.authorsRepo.findByIdForEnrichment(params.authorId);
    if (!author) return this.skipped('author_not_found');
    if (author.bookCount <= 0) return this.skipped('orphaned');

    const providerOrder = this.providersInUse(params.preferences);
    if (providerOrder.length === 0) return this.skipped('provider_disabled');

    const pinned = this.pinnedMatch(author);
    if (pinned && !providerOrder.includes(pinned.provider)) return this.skipped('provider_disabled');

    const { candidates, failures, outboundRequests, cacheServed } = pinned
      ? await this.collectPinned(pinned, directive)
      : await this.authorMetadataFetchService.collectByProvider({ name: author.name, region: 'us', limit: 1 }, providerOrder, directive);
    const provenance: AuthorEnrichmentProvenance = { outboundRequests, cacheServed };

    if (candidates.size === 0) {
      const failure = failures[0];
      if (!failure) return this.skipped('no_match', provenance);
      return {
        kind: 'failed',
        message: failure.message,
        provider: failure.provider,
        httpStatus: failure.httpStatus,
        retryAfterMs: failure.retryAfterMs,
        transient: failure.transient,
        descriptionUpdated: false,
        imageUpdated: false,
        fieldsUpdated: [],
        ...provenance,
      };
    }

    return this.applyCandidates(author, params.preferences, candidates, provenance);
  }

  /**
   * Makes the author exactly the chosen person. Every enabled field takes the candidate's value and
   * is cleared where the candidate has none, so nothing from an earlier, wrong match survives. The
   * portrait is fetched before anything is written, so a failed download leaves the author as it was.
   */
  async applyMatch(
    author: AuthorEnrichmentRow,
    preferences: AuthorMetadataPreferences,
    candidate: AuthorMetadataCandidate,
  ): Promise<AuthorMatchApplyResult> {
    const update: AuthorUpdate = {};
    const fieldsUpdated: AuthorMetadataField[] = [];
    let imageUpdated = false;
    let downloads = 0;

    if (preferences.fields.photo?.enabled) {
      if (candidate.imageUrl) {
        downloads += 1;
        try {
          imageUpdated = await this.authorImageStorage.saveFromUrl(author.id, candidate.imageUrl);
          if (!imageUpdated) {
            return {
              kind: 'failed',
              message: 'Failed to save author image',
              provider: candidate.provider,
              httpStatus: null,
              retryAfterMs: null,
              transient: false,
            };
          }
        } catch (error) {
          const storageError = error instanceof AuthorImageStorageError ? error : null;
          return {
            kind: 'failed',
            message: storageError?.message ?? (error instanceof Error ? error.message : 'Failed to save author image'),
            provider: candidate.provider,
            httpStatus: storageError?.httpStatus ?? null,
            retryAfterMs: storageError?.retryAfterMs ?? null,
            transient: storageError?.transient ?? true,
          };
        }
      } else if (author.hasPhoto) {
        await this.authorImageStorage.deleteAuthorDir(author.id);
        imageUpdated = true;
      }
      if (imageUpdated) fieldsUpdated.push('photo');
    }

    for (const field of ALL_AUTHOR_METADATA_FIELDS) {
      if (field === 'photo' || !preferences.fields[field]?.enabled) continue;
      const values = this.extractField(field, candidate, 'overwrite');
      if (!values) continue;
      Object.assign(update, values);
      fieldsUpdated.push(field);
    }

    update.metadataProvider = candidate.provider;
    update.metadataProviderId = candidate.providerId;
    update.metadataProviderPinned = true;
    update.hasPhoto = !!(await this.authorImageStorage.getThumbnailPath(author.id));
    update.lastEnrichedAt = new Date();
    await this.authorsRepo.updateAuthorById(author.id, update);

    return { kind: 'applied', imageUpdated, fieldsUpdated, downloads };
  }

  private pinnedMatch(author: AuthorEnrichmentRow): PinnedMatch | null {
    if (!author.metadataProviderPinned || !author.metadataProviderId) return null;
    if (!author.metadataProvider || !AUTHOR_PROVIDER_KEYS.has(author.metadataProvider)) return null;
    return { provider: author.metadataProvider as AuthorMetadataProviderKey, providerId: author.metadataProviderId };
  }

  /** A pinned author is looked up by id alone: a name search is what found the wrong person. */
  private async collectPinned(pinned: PinnedMatch, directive: CacheDirective) {
    const { candidate, failure, cacheServed, outboundRequests } = await this.authorMetadataFetchService.lookupByIdDetailed(
      pinned.provider,
      pinned.providerId,
      'us',
      { directive },
    );
    const candidates = new Map<AuthorMetadataProviderKey, AuthorMetadataCandidate>(candidate ? [[pinned.provider, candidate]] : []);
    return { candidates, failures: failure ? [failure] : [], cacheServed, outboundRequests };
  }

  private async applyCandidates(
    author: AuthorEnrichmentRow,
    preferences: AuthorMetadataPreferences,
    candidates: Map<AuthorMetadataProviderKey, AuthorMetadataCandidate>,
    provenance: AuthorEnrichmentProvenance,
  ): Promise<AuthorEnrichmentExecutionResult> {
    const update: AuthorUpdate = {};
    const downloads = { attempts: 0 };
    const fieldsUpdated: AuthorMetadataField[] = [];
    const winners = new Map<AuthorMetadataField, AuthorMetadataProviderKey>();
    let imageUpdated = false;

    for (const field of ALL_AUTHOR_METADATA_FIELDS) {
      const preference = preferences.fields[field];
      if (!preference?.enabled) continue;

      if (field === 'photo') {
        const photo = await this.applyPhoto(author, preference, candidates, downloads);
        if (photo) {
          if (photo.kind === 'failed') return { ...photo.result, ...this.withDownloads(provenance, downloads.attempts) };
          imageUpdated = true;
          fieldsUpdated.push('photo');
          winners.set('photo', photo.provider);
        }
        continue;
      }

      const resolved = this.resolveField(field, author, preference, candidates);
      if (!resolved) continue;

      Object.assign(update, resolved.values);
      fieldsUpdated.push(field);
      winners.set(field, resolved.provider);
    }

    const attribution = winners.get('description') ?? winners.get('photo') ?? [...winners.values()][0] ?? null;
    if (attribution && !author.metadataProviderPinned) {
      const candidate = candidates.get(attribution);
      update.metadataProvider = attribution;
      update.metadataProviderId = candidate?.providerId ?? null;
    }

    update.hasPhoto = !!(await this.authorImageStorage.getThumbnailPath(author.id));
    update.lastEnrichedAt = new Date();
    await this.authorsRepo.updateAuthorById(author.id, update);

    return {
      kind: 'done',
      provider: attribution,
      descriptionUpdated: fieldsUpdated.includes('description'),
      imageUpdated,
      fieldsUpdated,
      ...this.withDownloads(provenance, downloads.attempts),
    };
  }

  private withDownloads(provenance: AuthorEnrichmentProvenance, downloads: number): AuthorEnrichmentProvenance {
    return { outboundRequests: provenance.outboundRequests + downloads, cacheServed: provenance.cacheServed };
  }

  private resolveField(
    field: Exclude<AuthorMetadataField, 'photo'>,
    author: AuthorEnrichmentRow,
    preference: AuthorFieldPreference,
    candidates: Map<AuthorMetadataProviderKey, AuthorMetadataCandidate>,
  ): { values: AuthorUpdate; provider: AuthorMetadataProviderKey } | null {
    if (preference.mergeStrategy === 'fillMissing' && !this.isMissing(this.existingValue(field, author))) return null;

    for (const provider of preference.providers) {
      const candidate = candidates.get(provider);
      if (!candidate) continue;

      const values = this.extractField(field, candidate, preference.mergeStrategy);
      if (!values) continue;

      return { values, provider };
    }

    return null;
  }

  // Returns null when the provider has nothing usable for the field, so the
  // next provider in the order gets a turn. This is what stops a matched
  // author with an empty biography from blocking a provider that has one.
  private extractField(
    field: Exclude<AuthorMetadataField, 'photo'>,
    candidate: AuthorMetadataCandidate,
    mergeStrategy: MergeStrategy,
  ): AuthorUpdate | null {
    const allowEmpty = mergeStrategy === 'overwrite';

    switch (field) {
      case 'description': {
        const description = candidate.description?.trim() ?? '';
        if (!description && !allowEmpty) return null;
        return { description: description || null };
      }
      case 'birthDate': {
        if (!candidate.birthDate && !candidate.birthYear && !allowEmpty) return null;
        return { birthDate: candidate.birthDate ?? null, birthYear: candidate.birthYear ?? null };
      }
      case 'deathDate': {
        if (!candidate.deathDate && !candidate.deathYear && !allowEmpty) return null;
        return { deathDate: candidate.deathDate ?? null, deathYear: candidate.deathYear ?? null };
      }
      case 'website': {
        const website = candidate.website?.trim() ?? '';
        if (!website && !allowEmpty) return null;
        return { website: website || null };
      }
      case 'genres': {
        const genres = candidate.genres ?? [];
        if (genres.length === 0 && !allowEmpty) return null;
        return { genres: genres.length > 0 ? genres : null };
      }
      case 'influences': {
        const influences = candidate.influences ?? [];
        if (influences.length === 0 && !allowEmpty) return null;
        return { influences: influences.length > 0 ? influences : null };
      }
    }
  }

  private async applyPhoto(
    author: AuthorEnrichmentRow,
    preference: AuthorFieldPreference,
    candidates: Map<AuthorMetadataProviderKey, AuthorMetadataCandidate>,
    downloads: { attempts: number },
  ): Promise<
    { kind: 'stored'; provider: AuthorMetadataProviderKey } | { kind: 'failed'; result: Extract<AuthorEnrichmentOutcome, { kind: 'failed' }> } | null
  > {
    if (preference.mergeStrategy === 'fillMissing' && author.hasPhoto) return null;

    for (const provider of preference.providers) {
      const imageUrl = candidates.get(provider)?.imageUrl;
      if (!imageUrl) continue;

      // Counted per attempt rather than per request: a cached candidate still costs a download.
      downloads.attempts += 1;
      try {
        const stored = await this.authorImageStorage.saveFromUrl(author.id, imageUrl);
        if (!stored) continue;
        return { kind: 'stored', provider };
      } catch (error) {
        const storageError = error instanceof AuthorImageStorageError ? error : null;
        return {
          kind: 'failed',
          result: {
            kind: 'failed',
            message: storageError?.message ?? (error instanceof Error ? error.message : 'Failed to save author image'),
            provider,
            httpStatus: storageError?.httpStatus ?? null,
            retryAfterMs: storageError?.retryAfterMs ?? null,
            transient: storageError?.transient ?? true,
            descriptionUpdated: false,
            imageUpdated: false,
            fieldsUpdated: [],
          },
        };
      }
    }

    return null;
  }

  private existingValue(field: Exclude<AuthorMetadataField, 'photo'>, author: AuthorEnrichmentRow): unknown {
    switch (field) {
      case 'description':
        return author.description;
      case 'birthDate':
        return author.birthDate ?? author.birthYear;
      case 'deathDate':
        return author.deathDate ?? author.deathYear;
      case 'website':
        return author.website;
      case 'genres':
        return author.genres;
      case 'influences':
        return author.influences;
    }
  }

  private isMissing(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private providersInUse(preferences: AuthorMetadataPreferences): AuthorMetadataProviderKey[] {
    const ordered: AuthorMetadataProviderKey[] = [];
    for (const field of ALL_AUTHOR_METADATA_FIELDS) {
      const preference = preferences.fields[field];
      if (!preference?.enabled) continue;
      for (const provider of preference.providers) {
        if (!ordered.includes(provider)) ordered.push(provider);
      }
    }
    return ordered;
  }

  private skipped(reason: SkipReason, provenance: AuthorEnrichmentProvenance = NO_PROVENANCE): AuthorEnrichmentExecutionResult {
    return { kind: 'skipped', reason, provider: null, descriptionUpdated: false, imageUpdated: false, fieldsUpdated: [], ...provenance };
  }
}
