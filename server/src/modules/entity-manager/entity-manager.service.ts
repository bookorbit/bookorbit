import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type {
  BrowseEntitiesResponse,
  DeleteResult,
  DismissedPairInfo,
  DuplicateCluster,
  DuplicateScanResponse,
  DuplicateScanStatus,
  EntityInfo,
  EntityType,
  MergeResult,
  RenameResult,
  SplitResult,
  BulkDeleteResult,
} from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { FileWriteService } from '../file-write/file-write.service';
import { LibraryService } from '../library/library.service';
import { EntityManagerRepository } from './entity-manager.repository';
import { DuplicateComputeService } from './duplicate-compute.service';
import type { EntityStrategy, RawCandidatePair } from './strategies/entity-strategy.interface';
import { AuthorStrategy } from './strategies/author.strategy';
import { GenreStrategy } from './strategies/genre.strategy';
import { TagStrategy } from './strategies/tag.strategy';
import { NarratorStrategy } from './strategies/narrator.strategy';
import { PublisherStrategy } from './strategies/publisher.strategy';
import { LanguageStrategy } from './strategies/language.strategy';
import { SeriesStrategy } from './strategies/series.strategy';

const BOOK_TITLES_LIMIT = 5;
const DEFAULT_MIN_SIMILARITY = 0.5;
const DEFAULT_SCAN_PAGE = 1;
const DEFAULT_SCAN_PAGE_SIZE = 20;

function logErrorFields(err: unknown): { errorClass: string; error: string } {
  const error = err instanceof Error ? err : new Error(String(err));
  return { errorClass: error.name, error: sanitizeLogValue(error.message) };
}

@Injectable()
export class EntityManagerService {
  private readonly logger = new Logger(EntityManagerService.name);
  private readonly strategies: Map<EntityType, EntityStrategy>;

  constructor(
    private readonly repo: EntityManagerRepository,
    private readonly libraryService: LibraryService,
    private readonly fileWriteService: FileWriteService,
    private readonly duplicateCompute: DuplicateComputeService,
    authorStrategy: AuthorStrategy,
    genreStrategy: GenreStrategy,
    tagStrategy: TagStrategy,
    narratorStrategy: NarratorStrategy,
    publisherStrategy: PublisherStrategy,
    languageStrategy: LanguageStrategy,
    seriesStrategy: SeriesStrategy,
  ) {
    this.strategies = new Map<EntityType, EntityStrategy>([
      ['author', authorStrategy],
      ['genre', genreStrategy],
      ['tag', tagStrategy],
      ['narrator', narratorStrategy],
      ['publisher', publisherStrategy],
      ['language', languageStrategy],
      ['series', seriesStrategy],
    ]);
  }

  getStrategy(entityType: EntityType): EntityStrategy {
    const strategy = this.strategies.get(entityType);
    if (!strategy) throw new BadRequestException(`Unknown entity type: ${entityType}`);
    return strategy;
  }

  async scanDuplicates(
    entityType: EntityType,
    user: RequestUser,
    libraryId?: number,
    minSimilarity?: number,
    page = DEFAULT_SCAN_PAGE,
    pageSize = DEFAULT_SCAN_PAGE_SIZE,
  ): Promise<DuplicateScanResponse> {
    const event = 'entity_manager.scan_duplicates';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} entityType=${entityType} page=${page} pageSize=${pageSize} - duplicate scan started`);

    try {
      const strategy = this.getStrategy(entityType);
      const similarity = minSimilarity ?? DEFAULT_MIN_SIMILARITY;

      if (libraryId) {
        const allLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
        if (!allLibraryIds.includes(libraryId)) throw new BadRequestException('Library not accessible');
      }

      let rawPairs: RawCandidatePair[];

      if (strategy.isInline) {
        const allLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
        const libraryIds = libraryId ? allLibraryIds.filter((id) => id === libraryId) : allLibraryIds;
        rawPairs = await strategy.findCandidatePairs(libraryIds, similarity);

        const dismissedSet = await this.repo.getInlineDismissedPairSet(entityType);
        rawPairs = rawPairs.filter((pair) => !dismissedSet.has(`${pair.idA}:${pair.idB}`));
      } else {
        const storedPairs = await this.duplicateCompute.readCandidatePairs(entityType, similarity);

        if (storedPairs.length === 0) {
          const status = await this.duplicateCompute.getStatus(entityType);
          const shouldTrigger =
            !status ||
            (!status.isComputing && !status.computedAt) ||
            (!status.isComputing && status.threshold !== null && status.threshold > similarity);
          if (shouldTrigger) {
            this.duplicateCompute.triggerCompute(entityType, strategy, similarity);
          }
        }

        rawPairs = storedPairs.map((p) => ({
          idA: p.idA,
          idB: p.idB,
          nameA: '',
          nameB: '',
          simScore: p.simScore,
        }));
      }

      const clusterMap = this.buildClusters(rawPairs);
      const ranked = this.rankClusters(clusterMap, rawPairs);
      const total = ranked.length;

      const clampedPage = total > 0 ? Math.max(1, Math.min(page, Math.ceil(total / pageSize))) : 1;
      const offset = (clampedPage - 1) * pageSize;
      const pageSlice = ranked.slice(offset, offset + pageSize);

      const enrichedClusters = await this.enrichClusterSlice(strategy, pageSlice, rawPairs);

      this.logger.log(
        `[${event}] [end] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} total=${total} page=${clampedPage} clusters=${enrichedClusters.length} - duplicate scan completed`,
      );

      return {
        entityType,
        clusters: enrichedClusters,
        totalEntities: rawPairs.length > 0 ? new Set(rawPairs.flatMap((p) => [p.idA, p.idB])).size : 0,
        total,
        page: clampedPage,
        pageSize,
      };
    } catch (err) {
      const error = logErrorFields(err);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} errorClass=${error.errorClass} error="${error.error}" - duplicate scan failed`,
      );
      throw err;
    }
  }

  async getDuplicateScanStatus(entityType: EntityType): Promise<DuplicateScanStatus> {
    const strategy = this.getStrategy(entityType);

    if (strategy.isInline) {
      return { entityType, state: 'done', computedAt: null, totalPairs: null, threshold: null, progressPct: null };
    }

    const row = await this.duplicateCompute.getStatus(entityType);

    if (!row) {
      return { entityType, state: 'idle', computedAt: null, totalPairs: null, threshold: null, progressPct: null };
    }

    let state: DuplicateScanStatus['state'] = 'done';
    if (row.isComputing) state = 'computing';
    else if (row.errorMessage && !row.computedAt) state = 'error';
    else if (!row.computedAt) state = 'idle';

    const progressPct =
      row.isComputing && row.totalCount && row.processedCount !== null ? Math.round((row.processedCount / row.totalCount) * 100) : null;

    return {
      entityType,
      state,
      computedAt: row.computedAt ? row.computedAt.toISOString() : null,
      totalPairs: row.totalPairs ?? null,
      threshold: row.threshold ?? null,
      progressPct,
    };
  }

  async refreshDuplicates(entityType: EntityType, minSimilarity?: number): Promise<DuplicateScanStatus> {
    const strategy = this.getStrategy(entityType);
    const threshold = minSimilarity ?? DEFAULT_MIN_SIMILARITY;

    if (!strategy.isInline) {
      this.duplicateCompute.triggerCompute(entityType, strategy, threshold);
    }

    return this.getDuplicateScanStatus(entityType);
  }

  async browse(
    entityType: EntityType,
    user: RequestUser,
    params: { search?: string; page?: number; pageSize?: number; sortBy?: string; sortOrder?: string },
  ): Promise<BrowseEntitiesResponse> {
    const strategy = this.getStrategy(entityType);
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);

    const result = await strategy.browse({
      libraryIds,
      search: params.search,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 25,
      sortBy: (params.sortBy as 'name' | 'bookCount') || 'name',
      sortOrder: (params.sortOrder as 'asc' | 'desc') || 'asc',
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });

    return { items: result.items, total: result.total, page: params.page ?? 1, pageSize: params.pageSize ?? 25 };
  }

  async merge(
    entityType: EntityType,
    user: RequestUser,
    targetId: number | string,
    sourceIds: (number | string)[],
    writeFiles: boolean,
  ): Promise<MergeResult> {
    const event = 'entity_manager.merge';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] userId=${user.id} entityType=${entityType} targetId=${targetId} sourceCount=${sourceIds.length} - merge started`,
    );

    try {
      const strategy = this.getStrategy(entityType);
      const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const result = await strategy.merge({ targetId, sourceIds, userId: user.id, libraryIds });

      const nonInlineSourceIds: number[] = [];
      for (const sourceId of sourceIds) {
        if (strategy.isInline) {
          await this.repo.deleteInlineDismissedPairsForValue(entityType, sourceId as string);
        } else {
          await this.repo.deleteDismissedPairsForEntity(entityType, sourceId as number);
          nonInlineSourceIds.push(sourceId as number);
        }
      }

      if (nonInlineSourceIds.length > 0) {
        await this.duplicateCompute.invalidateCandidatesForEntities(entityType, nonInlineSourceIds);
      }

      if (writeFiles) {
        this.scheduleWrites(result.affectedBookIds, user.id);
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} affectedBooks=${result.affectedBookIds.length} - merge completed`,
      );

      return {
        targetId,
        mergedIds: sourceIds,
        affectedBookCount: result.affectedBookIds.length,
        imagePromoted: result.imagePromoted,
        fieldsResolved: result.fieldsResolved,
      };
    } catch (err) {
      const error = logErrorFields(err);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} errorClass=${error.errorClass} error="${error.error}" - merge failed`,
      );
      throw err;
    }
  }

  async rename(entityType: EntityType, user: RequestUser, entityId: number | string, newName: string, writeFiles: boolean): Promise<RenameResult> {
    const event = 'entity_manager.rename';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} entityType=${entityType} entityId=${entityId} - rename started`);

    try {
      const strategy = this.getStrategy(entityType);
      const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const result = await strategy.rename({ entityId, newName, userId: user.id, libraryIds });

      if (writeFiles) {
        this.scheduleWrites(result.affectedBookIds, user.id);
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} implicitMerge=${result.wasImplicitMerge} - rename completed`,
      );

      return {
        entityId,
        oldName: result.oldName,
        newName: newName.trim(),
        affectedBookCount: result.affectedBookIds.length,
        wasImplicitMerge: result.wasImplicitMerge,
        mergedEntityId: result.mergedEntityId,
      };
    } catch (err) {
      const error = logErrorFields(err);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} errorClass=${error.errorClass} error="${error.error}" - rename failed`,
      );
      throw err;
    }
  }

  async deleteEntity(
    entityType: EntityType,
    user: RequestUser,
    entityId: number | string,
    mode: 'soft' | 'hard' | 'inline',
    writeFiles: boolean,
  ): Promise<DeleteResult> {
    const event = 'entity_manager.delete';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} entityType=${entityType} entityId=${entityId} mode=${mode} - delete started`);

    try {
      const strategy = this.getStrategy(entityType);
      const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const result = await strategy.deleteEntity({ entityId, mode, libraryIds });

      if (strategy.isInline) {
        await this.repo.deleteInlineDismissedPairsForValue(entityType, entityId as string);
      } else if (mode === 'hard') {
        await this.repo.deleteDismissedPairsForEntity(entityType, entityId as number);
        await this.duplicateCompute.invalidateCandidatesForEntities(entityType, [entityId as number]);
      }

      if (writeFiles) {
        this.scheduleWrites(result.affectedBookIds, user.id);
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} affectedBooks=${result.affectedBookIds.length} - delete completed`,
      );

      return { entityId, name: result.name, affectedBookCount: result.affectedBookIds.length, mode };
    } catch (err) {
      const error = logErrorFields(err);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} errorClass=${error.errorClass} error="${error.error}" - delete failed`,
      );
      throw err;
    }
  }

  async bulkDelete(
    entityType: EntityType,
    user: RequestUser,
    entityIds: (number | string)[],
    mode: 'soft' | 'hard' | 'inline',
    writeFiles: boolean,
  ): Promise<BulkDeleteResult> {
    const results: DeleteResult[] = [];
    const errors: { entityId: number | string; error: string }[] = [];

    for (const entityId of entityIds) {
      try {
        const result = await this.deleteEntity(entityType, user, entityId, mode, writeFiles);
        results.push(result);
      } catch (err) {
        errors.push({ entityId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { results, errors };
  }

  async split(entityType: EntityType, user: RequestUser, entityId: number, newNames: string[], writeFiles: boolean): Promise<SplitResult> {
    const event = 'entity_manager.split';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} entityType=${entityType} entityId=${entityId} newCount=${newNames.length} - split started`);

    try {
      const strategy = this.getStrategy(entityType);

      if (strategy.isInline) {
        throw new BadRequestException('Split is not supported for inline entity types');
      }
      if (newNames.length < 2) {
        throw new BadRequestException('Split requires at least 2 new names');
      }

      const result = await strategy.split({ entityId, newNames });

      await this.repo.deleteDismissedPairsForEntity(entityType, entityId);

      if (writeFiles) {
        this.scheduleWrites(result.affectedBookIds, user.id);
      }

      this.logger.log(
        `[${event}] [end] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} newEntities=${result.newEntities.length} - split completed`,
      );

      return {
        originalId: entityId,
        originalName: result.originalName,
        newEntities: result.newEntities,
        affectedBookCount: result.affectedBookIds.length,
      };
    } catch (err) {
      const error = logErrorFields(err);
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} entityType=${entityType} durationMs=${Date.now() - startedAt} errorClass=${error.errorClass} error="${error.error}" - split failed`,
      );
      throw err;
    }
  }

  async dismissPair(entityType: EntityType, user: RequestUser, idA: number | string, idB: number | string, reason?: string): Promise<void> {
    const strategy = this.getStrategy(entityType);
    if (strategy.isInline) {
      await this.repo.insertInlineDismissedPair(entityType, idA as string, idB as string, reason, user.id);
    } else {
      await this.repo.insertDismissedPair(entityType, idA as number, idB as number, reason, user.id);
    }
  }

  async undismissPair(entityType: EntityType, _user: RequestUser, idA: number | string, idB: number | string): Promise<void> {
    const strategy = this.getStrategy(entityType);
    if (strategy.isInline) {
      await this.repo.deleteInlineDismissedPair(entityType, idA as string, idB as string);
    } else {
      await this.repo.deleteDismissedPair(entityType, idA as number, idB as number);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getDismissedPairs(entityType: EntityType, _user: RequestUser): Promise<DismissedPairInfo[]> {
    const strategy = this.getStrategy(entityType);

    if (strategy.isInline) {
      const pairs = await this.repo.findInlineDismissedPairs(entityType);
      return pairs.map((p) => ({
        id: p.id,
        entityType,
        nameA: p.valueA,
        nameB: p.valueB,
        idA: p.valueA,
        idB: p.valueB,
        reason: p.reason,
        dismissedAt: p.dismissedAt.toISOString(),
      }));
    }

    const pairs = await this.repo.findDismissedPairs(entityType);
    const uniqueIds = new Set<number | string>();
    for (const p of pairs) {
      uniqueIds.add(p.entityIdA);
      uniqueIds.add(p.entityIdB);
    }

    const entityMap = new Map<number | string, { id: number | string; name: string }>();
    await Promise.all(
      Array.from(uniqueIds).map(async (id) => {
        const entity = await strategy.findEntityById(id);
        if (entity) entityMap.set(id, entity);
      }),
    );

    const result: DismissedPairInfo[] = [];
    for (const pair of pairs) {
      const entityA = entityMap.get(pair.entityIdA);
      const entityB = entityMap.get(pair.entityIdB);
      if (!entityA || !entityB) continue;

      result.push({
        id: pair.id,
        entityType,
        nameA: entityA.name,
        nameB: entityB.name,
        idA: pair.entityIdA,
        idB: pair.entityIdB,
        reason: pair.reason,
        dismissedAt: pair.dismissedAt.toISOString(),
      });
    }

    return result;
  }

  async getEntityInfo(entityType: EntityType, entityId: number | string): Promise<EntityInfo> {
    const strategy = this.getStrategy(entityType);
    const entity = await strategy.findEntityById(entityId);
    if (!entity) throw new NotFoundException(`${entityType} not found`);

    const [bookCount, bookTitles] = await Promise.all([strategy.getBookCount(entityId), strategy.getBookTitles(entityId, BOOK_TITLES_LIMIT)]);

    return { id: entity.id, name: entity.name, bookCount, bookTitles };
  }

  // Union-find clustering
  private buildClusters(pairs: RawCandidatePair[]): Map<string, Set<string>> {
    const parent = new Map<string, string>();
    const rank = new Map<string, number>();

    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) {
        root = parent.get(root)!;
      }
      let current = x;
      while (current !== root) {
        const next = parent.get(current)!;
        parent.set(current, root);
        current = next;
      }
      return root;
    };

    const union = (a: string, b: string) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA === rootB) return;
      const rankA = rank.get(rootA) ?? 0;
      const rankB = rank.get(rootB) ?? 0;
      if (rankA < rankB) {
        parent.set(rootA, rootB);
      } else if (rankA > rankB) {
        parent.set(rootB, rootA);
      } else {
        parent.set(rootB, rootA);
        rank.set(rootA, rankA + 1);
      }
    };

    for (const pair of pairs) {
      const a = String(pair.idA);
      const b = String(pair.idB);
      if (!parent.has(a)) {
        parent.set(a, a);
        rank.set(a, 0);
      }
      if (!parent.has(b)) {
        parent.set(b, b);
        rank.set(b, 0);
      }
      union(a, b);
    }

    const clusters = new Map<string, Set<string>>();
    for (const key of parent.keys()) {
      const root = find(key);
      if (!clusters.has(root)) {
        clusters.set(root, new Set());
      }
      clusters.get(root)!.add(key);
    }

    return clusters;
  }

  private rankClusters(clusters: Map<string, Set<string>>, pairs: RawCandidatePair[]): Array<{ memberIds: Set<string>; avgSimilarity: number }> {
    const pairsByMember = new Map<string, RawCandidatePair[]>();
    for (const pair of pairs) {
      const a = String(pair.idA);
      const b = String(pair.idB);
      if (!pairsByMember.has(a)) pairsByMember.set(a, []);
      if (!pairsByMember.has(b)) pairsByMember.set(b, []);
      pairsByMember.get(a)!.push(pair);
      pairsByMember.get(b)!.push(pair);
    }

    const ranked: Array<{ memberIds: Set<string>; avgSimilarity: number }> = [];

    for (const [, memberIds] of clusters) {
      if (memberIds.size < 2) continue;

      let simSum = 0;
      let simCount = 0;
      const seen = new Set<string>();
      for (const memberId of memberIds) {
        for (const pair of pairsByMember.get(memberId) ?? []) {
          const pairKey = `${pair.idA}:${pair.idB}`;
          if (!seen.has(pairKey) && memberIds.has(String(pair.idA)) && memberIds.has(String(pair.idB))) {
            seen.add(pairKey);
            simSum += pair.simScore;
            simCount++;
          }
        }
      }
      const avgSimilarity = simCount > 0 ? simSum / simCount : 0;
      ranked.push({ memberIds, avgSimilarity });
    }

    return ranked.sort((a, b) => {
      if (b.avgSimilarity !== a.avgSimilarity) return b.avgSimilarity - a.avgSimilarity;
      const keyA = [...a.memberIds].sort()[0] ?? '';
      const keyB = [...b.memberIds].sort()[0] ?? '';
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });
  }

  private async enrichClusterSlice(
    strategy: EntityStrategy,
    rankedSlice: Array<{ memberIds: Set<string>; avgSimilarity: number }>,
    pairs: RawCandidatePair[],
  ): Promise<DuplicateCluster[]> {
    const enriched: DuplicateCluster[] = [];
    let clusterIndex = 0;

    for (const { memberIds, avgSimilarity } of rankedSlice) {
      const entities = await Promise.all(
        [...memberIds].map(async (id) => {
          const parsedId = strategy.isInline ? id : Number(id);
          const [entity, bookCount, bookTitles] = await Promise.all([
            strategy.findEntityById(parsedId),
            strategy.getBookCount(parsedId),
            strategy.getBookTitles(parsedId, BOOK_TITLES_LIMIT),
          ]);
          return entity
            ? { id: entity.id, name: entity.name, bookCount, bookTitles, sortName: (entity as any).sortName, hasPhoto: (entity as any).hasPhoto }
            : null;
        }),
      );

      const validEntities = entities.filter((e): e is NonNullable<typeof e> => e !== null);
      if (validEntities.length < 2) continue;

      const entityNameMap = new Map<string, string>(validEntities.map((entity) => [String(entity.id), entity.name]));
      const clusterPairs = pairs.filter((p) => memberIds.has(String(p.idA)) && memberIds.has(String(p.idB)));
      const suggestedTarget = validEntities.reduce((best, e) => (e.bookCount > best.bookCount ? e : best), validEntities[0]!);

      enriched.push({
        clusterId: `cluster-${clusterIndex++}`,
        entities: validEntities,
        averageSimilarity: Math.round(avgSimilarity * 100) / 100,
        suggestedTargetId: suggestedTarget.id,
        pairDetails: clusterPairs.map((p) => ({
          idA: p.idA,
          idB: p.idB,
          similarity: Math.round(p.simScore * 100) / 100,
          reasons: this.computeReasons(p.simScore, entityNameMap.get(String(p.idA)) ?? p.nameA, entityNameMap.get(String(p.idB)) ?? p.nameB),
        })),
      });
    }

    return enriched;
  }

  private computeReasons(simScore: number, nameA: string, nameB: string): string[] {
    const reasons: string[] = [];
    if (simScore >= 0.85) reasons.push('Very high name similarity');
    else if (simScore >= 0.7) reasons.push('High name similarity');
    else reasons.push('Moderate name similarity');

    const a = nameA.toLowerCase();
    const b = nameB.toLowerCase();
    if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
      reasons.push('Name containment');
    }

    const tokensA = a
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .sort();
    const tokensB = b
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .sort();
    if (tokensA.length > 0 && tokensA.join(' ') === tokensB.join(' ')) {
      reasons.push('Same normalized tokens');
    }

    return reasons;
  }

  private scheduleWrites(bookIds: number[], userId: number): void {
    const uniqueIds = [...new Set(bookIds)];
    for (const bookId of uniqueIds) {
      this.fileWriteService.scheduleWrite(bookId, 'auto', userId);
    }
  }
}
