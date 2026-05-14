import { Injectable } from '@nestjs/common';

import type { MigrationProfile, MigrationSource } from '../../../db/schema';
import { SourceAdapterRegistry } from '../adapters/source-adapter.registry';
import type { SourceExportData } from '../adapters/source-adapter.types';
import { parseConnectionConfig } from '../core/connection-config';
import { asRecord, asString, asNumber } from '../core/coerce';
import { MatchingService } from './matching.service';
import type {
  PathMapping,
  PlannedBookMatch,
  PlannedDuplicateBookMatch,
  PlannedDuplicateSourceCandidate,
  PlannerResult,
  PlannedMigration,
  PlannedUserPreview,
  UserMapping,
} from './planner.types';

const MATCHING_PRIORITY = ['isbn', 'file_hash', 'path_mapping', 'title_author'] as const;

@Injectable()
export class MigrationPlannerService {
  constructor(
    private readonly adapterRegistry: SourceAdapterRegistry,
    private readonly matchingService: MatchingService,
  ) {}

  async buildPlan(params: { source: MigrationSource; profile: MigrationProfile; scopeOverride?: Record<string, unknown> }): Promise<PlannerResult> {
    const { source, profile, scopeOverride } = params;
    const adapter = this.adapterRegistry.get(source.type);

    const connectionConfig = parseConnectionConfig(source.type, source.connectionConfig);
    const snapshot = await adapter.snapshot(connectionConfig);
    const sourceData = await adapter.exportData(connectionConfig);

    const userMappings = parseUserMappings(profile.userMappings);
    const pathMappings = parsePathMappings(profile.pathMappings);

    const scope = { ...asRecord(profile.scope), ...(scopeOverride ?? {}) };

    const { matches, unresolved } = await this.matchingService.matchBooks(sourceData.books, pathMappings);
    const sourceBooksById = new Map(sourceData.books.map((book) => [book.sourceBookId, book]));
    const { executableMatches, duplicateBookMatches } = splitDuplicateMatches(matches, sourceBooksById);

    const matchedBookIds = new Set(executableMatches.map((entry) => entry.sourceBookId));
    const mappedUsers = new Map(userMappings.map((entry) => [entry.sourceUserId, entry.targetUserId]));

    const userPreview = buildUserPreview(sourceData, mappedUsers, matchedBookIds);

    const plan: PlannedMigration = {
      generatedAt: new Date().toISOString(),
      snapshot,
      matchingPriority: [...MATCHING_PRIORITY],
      userMappings,
      pathMappings,
      scope,
      matchedBooks: executableMatches,
      unresolvedBooks: unresolved,
      duplicateBookMatches,
      userPreview,
    };

    return {
      plan,
      execution: {
        sourceData,
        matchedBooks: executableMatches,
        unresolvedBooks: unresolved,
        duplicateBookMatches,
      },
    };
  }
}

function splitDuplicateMatches(
  matches: PlannedBookMatch[],
  sourceBooksById: Map<string, { title: string | null; author: string | null; filePath: string | null }>,
): {
  executableMatches: PlannedBookMatch[];
  duplicateBookMatches: PlannedDuplicateBookMatch[];
} {
  const byTarget = new Map<number, PlannedBookMatch[]>();
  for (const match of matches) {
    const rows = byTarget.get(match.targetBookId) ?? [];
    rows.push(match);
    byTarget.set(match.targetBookId, rows);
  }

  const duplicateTargetIds = new Set<number>();
  const duplicateBookMatches: PlannedDuplicateBookMatch[] = [];
  for (const [targetBookId, rows] of byTarget) {
    if (rows.length < 2) continue;
    duplicateTargetIds.add(targetBookId);
    const sourceCandidates: PlannedDuplicateSourceCandidate[] = rows.map((row) => {
      const sourceBook = sourceBooksById.get(row.sourceBookId);
      return {
        sourceBookId: row.sourceBookId,
        title: sourceBook?.title ?? null,
        author: sourceBook?.author ?? null,
        filePath: sourceBook?.filePath ?? null,
        strategy: row.strategy,
      };
    });
    duplicateBookMatches.push({
      targetBookId,
      matches: rows,
      sourceBookIds: rows.map((row) => row.sourceBookId),
      strategies: rows.map((row) => row.strategy),
      sourceCandidates,
      reason: 'duplicate_target_match',
    });
  }

  return {
    executableMatches: matches.filter((match) => !duplicateTargetIds.has(match.targetBookId)),
    duplicateBookMatches,
  };
}

function parseUserMappings(raw: unknown): UserMapping[] {
  if (!Array.isArray(raw)) return [];

  const out: UserMapping[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const sourceUserId = asString((item as Record<string, unknown>).sourceUserId ?? (item as Record<string, unknown>).source_user_id);
    const targetUserId = asNumber((item as Record<string, unknown>).targetUserId ?? (item as Record<string, unknown>).target_user_id);
    if (!sourceUserId || !targetUserId) continue;

    out.push({ sourceUserId, targetUserId });
  }

  return out;
}

function parsePathMappings(raw: unknown): PathMapping[] {
  if (!Array.isArray(raw)) return [];

  const out: PathMapping[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const sourcePrefix = asString((item as Record<string, unknown>).sourcePrefix ?? (item as Record<string, unknown>).source_prefix);
    const targetPrefix = asString((item as Record<string, unknown>).targetPrefix ?? (item as Record<string, unknown>).target_prefix);
    if (!sourcePrefix || !targetPrefix) continue;

    out.push({ sourcePrefix, targetPrefix });
  }

  return out;
}

export function buildUserPreview(sourceData: SourceExportData, mappedUsers: Map<string, number>, matchedBookIds: Set<string>): PlannedUserPreview[] {
  const usersById = new Map(sourceData.users.map((user) => [user.sourceUserId, user]));
  const countsBySourceUser = new Map<string, { statuses: number; fileProgress: number; bookmarks: number; annotations: number; shelves: number }>();

  const increment = (sourceUserId: string, key: 'statuses' | 'fileProgress' | 'bookmarks' | 'annotations' | 'shelves') => {
    const current = countsBySourceUser.get(sourceUserId) ?? { statuses: 0, fileProgress: 0, bookmarks: 0, annotations: 0, shelves: 0 };
    current[key] += 1;
    countsBySourceUser.set(sourceUserId, current);
  };

  for (const row of sourceData.userBookStatuses) {
    if (mappedUsers.has(row.sourceUserId) && matchedBookIds.has(row.sourceBookId)) increment(row.sourceUserId, 'statuses');
  }
  for (const row of sourceData.userFileProgress) {
    if (mappedUsers.has(row.sourceUserId) && matchedBookIds.has(row.sourceBookId)) increment(row.sourceUserId, 'fileProgress');
  }
  for (const row of sourceData.bookmarks) {
    if (mappedUsers.has(row.sourceUserId) && matchedBookIds.has(row.sourceBookId)) increment(row.sourceUserId, 'bookmarks');
  }
  for (const row of sourceData.annotations) {
    if (mappedUsers.has(row.sourceUserId) && matchedBookIds.has(row.sourceBookId)) increment(row.sourceUserId, 'annotations');
  }

  const shelfById = new Map(sourceData.shelves.map((row) => [row.sourceShelfId, row]));
  for (const row of sourceData.shelfBooks) {
    if (!matchedBookIds.has(row.sourceBookId)) continue;
    const shelf = shelfById.get(row.sourceShelfId);
    const sourceUserId = row.sourceUserId || shelf?.sourceUserId;
    if (!sourceUserId) continue;
    if (!mappedUsers.has(sourceUserId)) continue;
    increment(sourceUserId, 'shelves');
  }

  return [...mappedUsers.entries()].map(([sourceUserId, targetUserId]) => {
    const sourceUser = usersById.get(sourceUserId);
    const counts = countsBySourceUser.get(sourceUserId) ?? { statuses: 0, fileProgress: 0, bookmarks: 0, annotations: 0, shelves: 0 };
    return {
      sourceUserId,
      targetUserId,
      username: sourceUser?.username ?? sourceUserId,
      counts,
    };
  });
}
