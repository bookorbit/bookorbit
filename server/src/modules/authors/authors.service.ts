import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { Observable } from 'rxjs';

import type {
  AuthorDetail,
  AuthorMetadataCandidate,
  AuthorMetadataProviderInfo,
  AuthorDuplicateSuggestion,
  AuthorInsights,
  AuthorInsightsRow,
  AuthorSummary,
  AuthorsPage,
  BooksPage,
  MergeAuthorsResult,
} from '@projectx/types';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import type { RequestUser } from '../../common/types/request-user';
import { books } from '../../db/schema';
import { BookRepository } from '../book/book.repository';
import { LibraryService } from '../library/library.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AuthorImageStorageService } from './author-image-storage.service';
import { AuthorEnrichmentExecutorService } from './author-enrichment-executor.service';
import { AuthorEnrichmentOrchestratorService } from './author-enrichment-orchestrator.service';
import { AuthorsRepository } from './authors.repository';
import { ListAuthorBooksDto } from './dto/list-author-books.dto';
import { DeleteAuthorsDto } from './dto/delete-authors.dto';
import { ListAuthorInsightsDto } from './dto/list-author-insights.dto';
import { ListAuthorMetadataDto } from './dto/list-author-metadata.dto';
import { ListAuthorsDto } from './dto/list-authors.dto';
import { ListDuplicateSuggestionsDto } from './dto/list-duplicate-suggestions.dto';
import { LookupAuthorMetadataDto } from './dto/lookup-author-metadata.dto';
import { MergeAuthorsDto } from './dto/merge-authors.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';
import { AuthorMetadataFetchService } from './metadata/author-metadata-fetch.service';

@Injectable()
export class AuthorsService {
  private static readonly BULK_AUDNEXUS_DELAY_MIN_MS = 250;
  private static readonly BULK_AUDNEXUS_DELAY_MAX_MS = 1_000;
  private readonly logger = new Logger(AuthorsService.name);

  constructor(
    private readonly authorsRepo: AuthorsRepository,
    private readonly bookRepo: BookRepository,
    private readonly libraryService: LibraryService,
    private readonly appSettings: AppSettingsService,
    private readonly authorMetadataFetchService: AuthorMetadataFetchService,
    private readonly authorImageStorage: AuthorImageStorageService,
    private readonly enrichmentExecutor: AuthorEnrichmentExecutorService,
    private readonly enrichmentOrchestrator: AuthorEnrichmentOrchestratorService,
  ) {}

  async findAll(user: RequestUser, dto: ListAuthorsDto): Promise<AuthorsPage> {
    const libraryIds = await this.resolveLibraryIds(user, dto.libraryId);
    if (libraryIds.length === 0) {
      return { items: [], total: 0, page: dto.page ?? 0, size: dto.size ?? 50 };
    }

    const page = await this.authorsRepo.findPage({
      q: dto.q,
      page: dto.page ?? 0,
      size: dto.size ?? 50,
      sort: dto.sort ?? 'name',
      order: dto.order ?? 'asc',
      libraryIds,
      hasPhoto: dto.hasPhoto,
      minBookCount: dto.minBookCount,
    });

    const mapped = page.items.map((item) => this.mapAuthorSummary(item));
    return {
      ...page,
      items: await this.withAuthorImageUrls(mapped),
    };
  }

  async findOne(user: RequestUser, authorId: number): Promise<AuthorDetail> {
    const libraryIds = await this.resolveLibraryIds(user);
    const row = await this.authorsRepo.findById(authorId, libraryIds);
    if (!row) throw new NotFoundException('Author not found');
    return this.withAuthorImageUrl(this.mapAuthorSummary(row) as AuthorDetail, 'full');
  }

  async findBooks(user: RequestUser, authorId: number, dto: ListAuthorBooksDto): Promise<BooksPage> {
    const libraryIds = await this.resolveLibraryIds(user, dto.libraryId);
    if (libraryIds.length === 0) {
      return { items: [], total: 0, page: dto.page ?? 0, size: dto.size ?? 50 };
    }

    const author = await this.authorsRepo.findById(authorId, libraryIds);
    if (!author) throw new NotFoundException('Author not found');

    const page = await this.authorsRepo.findBookIdsPage({
      authorId,
      page: dto.page ?? 0,
      size: dto.size ?? 50,
      sort: dto.sort ?? 'addedAt',
      order: dto.order ?? 'desc',
      libraryIds,
    });

    if (page.bookIds.length === 0) {
      return { items: [], total: page.total, page: page.page, size: page.size };
    }

    const orderMap = new Map(page.bookIds.map((id, index) => [id, index]));
    const { rows, authorRows, fileRows, genreRows, tagRows, progressRows } = await this.bookRepo.findCards({
      where: inArray(books.id, page.bookIds),
      orderBy: [],
      limit: page.bookIds.length,
      offset: 0,
      userId: user.id,
    });

    const items = assembleBookCards(rows, authorRows, fileRows, genreRows, tagRows, progressRows).sort(
      (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0),
    );

    return { items, total: page.total, page: page.page, size: page.size };
  }

  async listDuplicateSuggestions(user: RequestUser, dto: ListDuplicateSuggestionsDto): Promise<AuthorDuplicateSuggestion[]> {
    const libraryIds = await this.resolveLibraryIds(user, dto.libraryId);
    if (libraryIds.length === 0) return [];

    const minConfidence = dto.minConfidence ?? 0.82;
    const limit = dto.limit ?? 20;
    const poolSize = dto.poolSize ?? 250;

    const authors = await this.authorsRepo.findAuthorsForDuplicatePool(libraryIds, poolSize);
    if (authors.length < 2) return [];

    const suggestions: AuthorDuplicateSuggestion[] = [];
    for (let i = 0; i < authors.length; i += 1) {
      for (let j = i + 1; j < authors.length; j += 1) {
        const left = authors[i]!;
        const right = authors[j]!;
        const score = this.scorePotentialDuplicate(left, right);
        if (!score || score.confidence < minConfidence) continue;

        suggestions.push({
          left: this.mapAuthorSummary(left),
          right: this.mapAuthorSummary(right),
          confidence: score.confidence,
          reasons: score.reasons,
        });
      }
    }

    suggestions.sort((a, b) => b.confidence - a.confidence || b.left.bookCount - a.left.bookCount || b.right.bookCount - a.right.bookCount);
    return suggestions.slice(0, limit);
  }

  listMetadataProviders(): AuthorMetadataProviderInfo[] {
    return this.authorMetadataFetchService.listProviders();
  }

  async searchMetadata(dto: ListAuthorMetadataDto): Promise<AuthorMetadataCandidate[]> {
    return this.authorMetadataFetchService.search(
      {
        name: dto.q,
        region: dto.region,
        limit: dto.limit,
      },
      { keys: dto.providers },
    );
  }

  async lookupMetadata(dto: LookupAuthorMetadataDto): Promise<AuthorMetadataCandidate | null> {
    return this.authorMetadataFetchService.lookupById(dto.provider, dto.id, dto.region);
  }

  streamMetadata(dto: ListAuthorMetadataDto): Observable<AuthorMetadataCandidate> {
    return this.authorMetadataFetchService.stream(
      {
        name: dto.q,
        region: dto.region,
        limit: dto.limit,
      },
      { keys: dto.providers },
    );
  }

  async getInsights(user: RequestUser, dto: ListAuthorInsightsDto): Promise<AuthorInsights> {
    const libraryIds = await this.resolveLibraryIds(user, dto.libraryId);
    const limit = dto.limit ?? 8;
    const windowDays = dto.windowDays ?? 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    if (libraryIds.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        windowDays,
        newAuthors: [],
        mostRead: [],
        unreadBacklog: [],
      };
    }

    const [newRows, mostReadRows, authorBookPairs, startedBookIds] = await Promise.all([
      this.authorsRepo.findAuthorsAddedSince(libraryIds, since, limit),
      this.authorsRepo.findMostReadAuthors(libraryIds, since, limit),
      this.authorsRepo.findAuthorBookPairs(libraryIds),
      this.authorsRepo.findStartedBookIdsForUser(user.id, libraryIds),
    ]);

    const startedSet = new Set(startedBookIds);
    const unreadByAuthor = new Map<number, { name: string; bookCount: number; unreadCount: number; lastAddedAt: Date | null }>();
    const seenBookIdsByAuthor = new Map<number, Set<number>>();

    for (const row of authorBookPairs) {
      const seen = seenBookIdsByAuthor.get(row.authorId) ?? new Set<number>();
      if (seen.has(row.bookId)) continue;
      seen.add(row.bookId);
      seenBookIdsByAuthor.set(row.authorId, seen);

      const current = unreadByAuthor.get(row.authorId) ?? {
        name: row.name,
        bookCount: 0,
        unreadCount: 0,
        lastAddedAt: null,
      };

      current.bookCount += 1;
      if (!startedSet.has(row.bookId)) {
        current.unreadCount += 1;
      }
      if (!current.lastAddedAt || current.lastAddedAt < row.addedAt) {
        current.lastAddedAt = row.addedAt;
      }
      unreadByAuthor.set(row.authorId, current);
    }

    const unreadBacklog = [...unreadByAuthor.entries()]
      .filter(([, row]) => row.unreadCount > 0)
      .sort((a, b) => b[1].unreadCount - a[1].unreadCount || b[1].bookCount - a[1].bookCount)
      .slice(0, limit)
      .map(
        ([id, row]): AuthorInsightsRow => ({
          id,
          name: row.name,
          bookCount: row.bookCount,
          lastAddedAt: row.lastAddedAt ? row.lastAddedAt.toISOString() : null,
          metric: row.unreadCount,
          secondaryMetric: row.bookCount,
        }),
      );

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      newAuthors: newRows.map((row) => this.mapInsightRow(row)),
      mostRead: mostReadRows.filter((row) => row.metric > 0).map((row) => this.mapInsightRow(row)),
      unreadBacklog,
    };
  }

  async update(user: RequestUser, authorId: number, dto: UpdateAuthorDto): Promise<AuthorDetail> {
    await this.assertMutationAccess(user, [authorId]);

    const values: Parameters<AuthorsRepository['updateAuthorById']>[1] = {};

    if ('name' in dto) {
      const name = dto.name?.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      values.name = name;
    }

    if ('sortName' in dto) {
      values.sortName = dto.sortName?.trim() || null;
    }

    if ('description' in dto) {
      values.description = dto.description?.trim() || null;
    }

    if (Object.keys(values).length === 0) {
      return this.findOne(user, authorId);
    }

    const updated = await this.authorsRepo.updateAuthorById(authorId, values);
    if (!updated) throw new NotFoundException('Author not found');
    if (values.name !== undefined) {
      await this.enrichmentOrchestrator.schedule(authorId, 'author_rename');
    }
    this.logger.log(`author.update userId=${user.id} authorId=${authorId} fields=${Object.keys(values).join(',')}`);

    return this.findOne(user, authorId);
  }

  async merge(user: RequestUser, dto: MergeAuthorsDto): Promise<MergeAuthorsResult> {
    if (!this.isSuperuser(user)) {
      throw new ForbiddenException('Only superusers can merge authors');
    }

    const uniqueSourceIds = [...new Set(dto.sourceAuthorIds)].filter((id) => id !== dto.targetAuthorId);
    if (uniqueSourceIds.length === 0) {
      throw new BadRequestException('sourceAuthorIds must include at least one author different from targetAuthorId');
    }

    const allAuthorIds = [dto.targetAuthorId, ...uniqueSourceIds];
    await this.assertMutationAccess(user, allAuthorIds);

    const affectedBookCount = await this.authorsRepo.countDistinctBooks(uniqueSourceIds);
    await this.authorsRepo.mergeAuthors(dto.targetAuthorId, uniqueSourceIds);
    await this.enrichmentOrchestrator.schedule(dto.targetAuthorId, 'author_merge_target');
    this.logger.log(
      `author.merge userId=${user.id} targetAuthorId=${dto.targetAuthorId} sourceAuthorIds=${uniqueSourceIds.join(',')} affectedBookCount=${affectedBookCount}`,
    );
    const target = await this.findOne(user, dto.targetAuthorId);

    return {
      target,
      mergedAuthorIds: uniqueSourceIds,
      affectedBookCount,
    };
  }

  async delete(user: RequestUser, dto: DeleteAuthorsDto): Promise<{ deletedAuthorIds: number[]; affectedBookCount: number }> {
    if (!this.isSuperuser(user)) {
      throw new ForbiddenException('Only superusers can delete authors');
    }

    const authorIds = [...new Set(dto.authorIds)];
    await this.assertMutationAccess(user, authorIds);

    const affectedBookCount = await this.authorsRepo.countDistinctBooks(authorIds);
    await this.authorsRepo.deleteAuthors(authorIds);
    this.logger.log(`author.delete userId=${user.id} authorIds=${authorIds.join(',')} affectedBookCount=${affectedBookCount}`);

    return {
      deletedAuthorIds: authorIds,
      affectedBookCount,
    };
  }

  async refreshEnrichment(user: RequestUser, authorId: number): Promise<AuthorDetail> {
    await this.assertMutationAccess(user, [authorId]);

    const result = await this.refreshEnrichmentInternal(authorId);

    this.logger.log(
      `author.enrichment.refresh userId=${user.id} authorId=${authorId} provider=${result.provider ?? 'none'} descriptionUpdated=${result.descriptionUpdated} imageUpdated=${result.imageUpdated}`,
    );
    return this.findOne(user, authorId);
  }

  async getThumbnailPath(user: RequestUser, authorId: number): Promise<string | null> {
    await this.assertAuthorReadable(user, [authorId]);
    return this.authorImageStorage.getThumbnailPath(authorId);
  }

  async getImagePath(user: RequestUser, authorId: number): Promise<string | null> {
    await this.assertAuthorReadable(user, [authorId]);
    return this.authorImageStorage.getImagePath(authorId);
  }

  async bulkRefreshMetadata(
    authorIds: number[],
    user: RequestUser,
    onProgress?: (event: { authorId: number; updated: boolean; imageUpdated?: boolean; imageUrl?: string | null; error?: string }) => void,
  ): Promise<{ processed: number; failed: number; updated: number }> {
    const uniqueAuthorIds = [...new Set(authorIds)];
    if (uniqueAuthorIds.length === 0) {
      return { processed: 0, failed: 0, updated: 0 };
    }

    await this.assertMutationAccess(user, uniqueAuthorIds);

    let processed = 0;
    let failed = 0;
    let updated = 0;

    for (let index = 0; index < uniqueAuthorIds.length; index += 1) {
      const authorId = uniqueAuthorIds[index]!;
      let didUpdate = false;
      let imageUpdated = false;
      let imageUrl: string | null | undefined;
      let errorMessage: string | undefined;

      try {
        const result = await this.refreshEnrichmentInternal(authorId);
        didUpdate = result.descriptionUpdated || result.imageUpdated;
        imageUpdated = result.imageUpdated;
        if (imageUpdated) {
          imageUrl = await this.authorImageStorage.getThumbnailUrlIfExists(authorId);
        }
        if (didUpdate) {
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        errorMessage = error instanceof Error ? error.message : 'Failed to refresh metadata';
        this.logger.warn(`author.enrichment.bulk authorId=${authorId} error=${JSON.stringify(errorMessage)}`);
      }

      processed += 1;
      try {
        onProgress?.({ authorId, updated: didUpdate, imageUpdated, imageUrl, error: errorMessage });
      } catch {
        // callback threw (e.g. client disconnected) — stop the loop
        break;
      }

      if (index < uniqueAuthorIds.length - 1) {
        await this.sleep(this.getBulkAudnexusDelayMs());
      }
    }

    this.logger.log(`author.enrichment.bulk userId=${user.id} processed=${processed} updated=${updated} failed=${failed}`);
    return { processed, failed, updated };
  }

  private async resolveLibraryIds(user: RequestUser, scopedLibraryId?: number): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    const accessibleIds = libraries.map((library) => library.id);

    if (!scopedLibraryId) return accessibleIds;
    return accessibleIds.includes(scopedLibraryId) ? [scopedLibraryId] : [];
  }

  private async assertAuthorReadable(user: RequestUser, authorIds: number[]) {
    const libraryIds = await this.resolveLibraryIds(user);
    const visible = await this.authorsRepo.findVisibleAuthorIds(authorIds, libraryIds);
    if (visible.length !== authorIds.length) {
      throw new NotFoundException('Author not found');
    }
  }

  private async assertMutationAccess(user: RequestUser, authorIds: number[]) {
    const libraryIds = await this.resolveLibraryIds(user);
    const [visible, relatedLibraryIds] = await Promise.all([
      this.authorsRepo.findVisibleAuthorIds(authorIds, libraryIds),
      this.authorsRepo.findRelatedLibraryIds(authorIds),
    ]);
    if (visible.length !== authorIds.length) {
      throw new NotFoundException('Author not found');
    }
    const accessibleSet = new Set(libraryIds);
    if (relatedLibraryIds.some((libraryId) => !accessibleSet.has(libraryId))) {
      throw new ForbiddenException('Insufficient library access to mutate one or more selected authors');
    }
  }

  private isSuperuser(user: RequestUser): boolean {
    return user.isSuperuser;
  }

  private mapAuthorSummary(row: {
    id: number;
    name: string;
    sortName: string | null;
    description: string | null;
    bookCount: number;
    lastAddedAt: Date | null;
  }): AuthorSummary {
    return {
      id: row.id,
      name: row.name,
      sortName: row.sortName,
      description: row.description,
      bookCount: row.bookCount,
      lastAddedAt: row.lastAddedAt ? row.lastAddedAt.toISOString() : null,
    };
  }

  private async withAuthorImageUrls(items: AuthorSummary[]): Promise<AuthorSummary[]> {
    return Promise.all(items.map((item) => this.withAuthorImageUrl(item)));
  }

  private async withAuthorImageUrl<T extends AuthorSummary>(item: T, size: 'thumbnail' | 'full' = 'thumbnail'): Promise<T> {
    let imageUrl: string | null;
    if (size === 'full') {
      imageUrl = await this.authorImageStorage.getImageUrlIfExists(item.id);
      if (!imageUrl) {
        imageUrl = await this.authorImageStorage.getThumbnailUrlIfExists(item.id);
      }
    } else {
      imageUrl = await this.authorImageStorage.getThumbnailUrlIfExists(item.id);
    }

    return {
      ...item,
      imageUrl,
    };
  }

  private mapInsightRow(row: {
    id: number;
    name: string;
    bookCount: number;
    lastAddedAt: Date | null;
    metric: number;
    secondaryMetric: number | null;
  }): AuthorInsightsRow {
    return {
      id: row.id,
      name: row.name,
      bookCount: row.bookCount,
      lastAddedAt: row.lastAddedAt ? row.lastAddedAt.toISOString() : null,
      metric: row.metric,
      secondaryMetric: row.secondaryMetric,
    };
  }

  private async refreshEnrichmentInternal(
    authorId: number,
  ): Promise<{ descriptionUpdated: boolean; imageUpdated: boolean; provider: string | null }> {
    const writeMode = await this.appSettings.getAuthorsAutoEnrichmentWriteMode();
    const result = await this.enrichmentExecutor.execute({
      authorId,
      writeMode,
      audnexusEnabled: true,
    });

    if (result.kind === 'skipped' && result.reason === 'author_not_found') {
      throw new NotFoundException('Author not found');
    }

    if (result.kind === 'failed') {
      this.logger.warn(`author.enrichment.refresh.failed authorId=${authorId} status=${result.httpStatus ?? 'none'} message=${result.message}`);
      return { descriptionUpdated: false, imageUpdated: false, provider: result.provider };
    }

    return {
      descriptionUpdated: result.descriptionUpdated,
      imageUpdated: result.imageUpdated,
      provider: result.provider,
    };
  }

  private scorePotentialDuplicate(
    left: { id: number; name: string; sortName: string | null },
    right: { id: number; name: string; sortName: string | null },
  ): { confidence: number; reasons: string[] } | null {
    const leftSet = this.buildCanonicalSet(left.name, left.sortName);
    const rightSet = this.buildCanonicalSet(right.name, right.sortName);

    const reasons: string[] = [];
    let confidence = 0;

    for (const candidate of leftSet) {
      if (candidate && rightSet.has(candidate)) {
        confidence = Math.max(confidence, 0.98);
        reasons.push('same canonical name');
        break;
      }
    }

    const leftPrimary = this.normalizeName(left.name);
    const rightPrimary = this.normalizeName(right.name);

    if (leftPrimary && rightPrimary) {
      const similarity = this.diceCoefficient(leftPrimary, rightPrimary);
      if (similarity >= 0.94) {
        confidence = Math.max(confidence, 0.93);
        reasons.push('very high name similarity');
      } else if (similarity >= 0.88) {
        confidence = Math.max(confidence, 0.86);
        reasons.push('high name similarity');
      }

      if (leftPrimary.includes(rightPrimary) || rightPrimary.includes(leftPrimary)) {
        confidence = Math.max(confidence, 0.84);
        reasons.push('one name contains the other');
      }
    }

    if (confidence === 0) return null;
    return {
      confidence: Math.round(confidence * 100) / 100,
      reasons: [...new Set(reasons)],
    };
  }

  private buildCanonicalSet(name: string, sortName: string | null): Set<string> {
    const values = [name, sortName ?? ''].map((value) => this.normalizeName(value)).filter(Boolean);
    return new Set(values);
  }

  private normalizeName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private diceCoefficient(left: string, right: string): number {
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) return 0;

    const bigrams = (input: string): string[] => {
      const parts: string[] = [];
      for (let i = 0; i < input.length - 1; i += 1) {
        parts.push(input.slice(i, i + 2));
      }
      return parts;
    };

    const leftPairs = bigrams(left);
    const rightPairs = bigrams(right);
    const leftCounts = new Map<string, number>();

    for (const pair of leftPairs) {
      leftCounts.set(pair, (leftCounts.get(pair) ?? 0) + 1);
    }

    let intersection = 0;
    for (const pair of rightPairs) {
      const count = leftCounts.get(pair) ?? 0;
      if (count > 0) {
        leftCounts.set(pair, count - 1);
        intersection += 1;
      }
    }

    return (2 * intersection) / (leftPairs.length + rightPairs.length);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getBulkAudnexusDelayMs(): number {
    const min = AuthorsService.BULK_AUDNEXUS_DELAY_MIN_MS;
    const max = AuthorsService.BULK_AUDNEXUS_DELAY_MAX_MS;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
