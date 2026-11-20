import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  STORY_GUIDE_FEATURE,
  STORY_GUIDE_FIX_TOMBSTONE_DAYS,
  STORY_GUIDE_FIXES_PAGE_MAX,
  STORY_GUIDE_FIXES_PER_TEXT_MAX,
  type StoryGuideFix,
  type StoryGuideFixesPage,
  type StoryGuidePayloadV1,
} from '@bookorbit/types';

import type { RequestUser } from '../../../common/types/request-user';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { StoryGuideFixRow } from '../../../db/schema';
import { AiJobsService } from '../../ai-jobs/ai-jobs.service';
import { BookService } from '../../book/book.service';
import type { PutStoryGuideFixDto, StoryGuideFixesQueryDto } from '../dto/story-guide-fix.dto';
import { StoryTextService } from '../story-text.service';
import { isStoryTextFormat } from '../story-text.types';
import { applyStoryGuideFixes, type StoryGuideFixInput, type StoryGuideFixOutcome } from './apply-fixes';
import { StoryGuideFixesRepository, type StoryGuideFixesState } from './story-guide-fixes.repository';

export const STORY_GUIDE_FIXES_LIMIT_REACHED = 'STORY_GUIDE_FIXES_LIMIT_REACHED';
/** The file's text key is not known yet: the key job reads it in the background. Try again later. */
export const STORY_GUIDE_TEXT_CHECKING = 'STORY_GUIDE_TEXT_CHECKING';

const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH = 5_000;
const PURGE_ROUNDS = 20;
/** Matching results kept per (guide, fixes revision), so polling status or the list does not reapply. */
const MATCHING_CACHE_SIZE = 64;

/** Which live fixes find no target in the guide served now, and which found theirs by former names. */
export interface StoryGuideFixMatching {
  orphans: string[];
  rematched: Record<string, string>;
}

const NO_MATCHING: StoryGuideFixMatching = { orphans: [], rematched: {} };

export function toStoryGuideFix(row: StoryGuideFixRow): StoryGuideFix {
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    data: row.data,
    from: row.fromSection === null || row.fromOffset === null ? null : { s: row.fromSection, o: row.fromOffset },
    updatedAt: row.clientUpdatedAt.toISOString(),
    deleted: row.deleted,
  };
}

function toInput(row: StoryGuideFixRow): StoryGuideFixInput {
  const fix = toStoryGuideFix(row);
  return { id: fix.id, kind: fix.kind, target: fix.target, data: fix.data, from: fix.from };
}

function matchingOf(outcomes: ReadonlyMap<string, StoryGuideFixOutcome>): StoryGuideFixMatching {
  const orphans: string[] = [];
  const rematched: Record<string, string> = {};
  for (const [id, outcome] of outcomes) {
    if (!outcome.applied) orphans.push(id);
    else if (outcome.via === 'names') rematched[id] = outcome.key;
  }
  return { orphans, rematched };
}

/** ISO 8601 admits forms such as week dates that `Date` cannot read; those are refused, not stored as NaN. */
function parseClientTime(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('updatedAt must be an ISO 8601 date and time');
  return parsed;
}

/**
 * Fixes made to a text's story guide for everyone: stored per text key, applied to the guide in
 * the order they were made each time it is served, and matched again whenever the guide changes,
 * so a Rebuild keeps every fix whose target it still has.
 */
@Injectable()
export class StoryGuideFixesService {
  private readonly logger = new Logger(StoryGuideFixesService.name);
  private readonly matchingCache = new Map<string, StoryGuideFixMatching>();

  constructor(
    private readonly repository: StoryGuideFixesRepository,
    private readonly texts: StoryTextService,
    private readonly books: BookService,
    private readonly jobs: AiJobsService,
  ) {}

  /** Fixes changed after `since`, oldest change first, tombstones included, with the current matching. */
  async list(fileId: number, user: RequestUser, query: StoryGuideFixesQueryDto): Promise<StoryGuideFixesPage> {
    const textKey = await this.textKeyOf(fileId, user);
    const since = query.since ? query.since : '0';
    const limit = query.limit ?? STORY_GUIDE_FIXES_PAGE_MAX;
    if (!textKey) return { fixes: [], cursor: since, hasMore: false, ...NO_MATCHING };

    const rows = await this.repository.listSince(textKey, Number(since), limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      fixes: page.map(toStoryGuideFix),
      cursor: last ? String(last.revision) : since,
      hasMore: rows.length > limit,
      ...(await this.matching(textKey)),
    };
  }

  /** Answers the fix as stored, which is the existing one untouched when it is newer than this write. */
  async put(fileId: number, id: string, user: RequestUser, dto: PutStoryGuideFixDto): Promise<StoryGuideFix> {
    const textKey = await this.textKeyOf(fileId, user);
    if (!textKey) {
      throw new ConflictException({ message: "The book file's text is still being read; try again shortly", errorCode: STORY_GUIDE_TEXT_CHECKING });
    }
    const result = await this.repository.write(
      {
        textKey,
        id,
        kind: dto.kind,
        target: { key: dto.target.key, names: dto.target.names },
        data: dto.data,
        from: dto.from ? { s: dto.from.s, o: dto.from.o } : null,
        clientUpdatedAt: parseClientTime(dto.updatedAt),
        deleted: dto.deleted ?? false,
        userId: user.id,
      },
      STORY_GUIDE_FIXES_PER_TEXT_MAX,
    );
    if (result.outcome === 'refused') {
      throw new ConflictException({
        message: `A story guide holds at most ${STORY_GUIDE_FIXES_PER_TEXT_MAX} fixes`,
        errorCode: STORY_GUIDE_FIXES_LIMIT_REACHED,
        errorMeta: { limit: STORY_GUIDE_FIXES_PER_TEXT_MAX },
      });
    }
    return toStoryGuideFix(result.row);
  }

  state(textKey: string): Promise<StoryGuideFixesState> {
    return this.repository.state(textKey);
  }

  /**
   * The guide with its text's live fixes applied and `fixesRevision` set. `state` is what the
   * caller read for the tag, so the body always matches the tag it is served under.
   */
  async apply(textKey: string, payload: StoryGuidePayloadV1, sha256: string, state: StoryGuideFixesState): Promise<StoryGuidePayloadV1> {
    if (state.live === 0) return { ...payload, fixesRevision: state.revision };
    const applied = applyStoryGuideFixes(payload, (await this.repository.listLive(textKey)).map(toInput));
    this.remember(sha256, state.revision, matchingOf(applied.outcomes));
    return { ...applied.payload, fixesRevision: state.revision };
  }

  /** How many live fixes find no target in the guide served now; 0 without a guide. */
  async orphanCount(textKey: string): Promise<number> {
    return (await this.matching(textKey)).orphans.length;
  }

  /** Deletes a text's fixes, as tombstones so every device learns of it. */
  async removeForText(textKey: string, user: RequestUser): Promise<number> {
    const removed = await this.repository.removeForText(textKey, user.id);
    if (removed > 0) this.logger.log(`[story_guide_fixes.remove] [end] textKey=${textKey} removed=${removed} - shared fixes deleted with the guide`);
    return removed;
  }

  /** Deletes every text's fixes, one text at a time under its write lock. */
  async removeAll(user: RequestUser): Promise<number> {
    let removed = 0;
    for (const textKey of await this.repository.textsWithLiveFixes()) removed += await this.repository.removeForText(textKey, user.id);
    this.logger.log(`[story_guide_fixes.remove_all] [end] removed=${removed} - every shared fix deleted`);
    return removed;
  }

  countLive(): Promise<number> {
    return this.repository.countLive();
  }

  /** Fixes follow their text to the key it has under new text rules, as its guide does. */
  async move(fromKey: string, toKey: string): Promise<number> {
    return await this.repository.move(fromKey, toKey);
  }

  /** Tombstones older than the keep period, so devices offline for longer read the list from the start. */
  @Interval(DAY_MS)
  async purgeTombstones(): Promise<void> {
    const startedAt = Date.now();
    try {
      const before = new Date(startedAt - STORY_GUIDE_FIX_TOMBSTONE_DAYS * DAY_MS);
      let removed = 0;
      for (let round = 0; round < PURGE_ROUNDS; round++) {
        const count = await this.repository.purgeTombstones(before, PURGE_BATCH);
        removed += count;
        if (count < PURGE_BATCH) break;
      }
      if (removed > 0) {
        this.logger.log(`[story_guide_fixes.purge] [end] removed=${removed} durationMs=${Date.now() - startedAt} - old fix tombstones removed`);
      }
    } catch (error) {
      this.logger.warn(
        `[story_guide_fixes.purge] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - old fix tombstones not removed`,
      );
    }
  }

  /** The file's text key: null while the key job has not read it. 404 for a file out of reach or not a text. */
  private async textKeyOf(fileId: number, user: RequestUser): Promise<string | null> {
    const file = await this.texts.file(fileId);
    if (!file) throw new NotFoundException(`Book file ${fileId} not found`);
    await this.books.verifyBookAccess(file.bookId, user);
    if (!isStoryTextFormat(file.format)) throw new NotFoundException(`Book file ${fileId} has no story guide`);
    return (await this.texts.cached(file))?.textKey ?? null;
  }

  private async matching(textKey: string): Promise<StoryGuideFixMatching> {
    const state = await this.repository.state(textKey);
    if (state.live === 0) return NO_MATCHING;
    const info = await this.jobs.artifactInfo(STORY_GUIDE_FEATURE, textKey);
    if (!info) return NO_MATCHING;
    const cached = this.matchingCache.get(`${info.sha256}:${state.revision}`);
    if (cached) return cached;
    const read = await this.jobs.readArtifact(STORY_GUIDE_FEATURE, textKey, [1]);
    if (read.kind !== 'found') return NO_MATCHING;
    const applied = applyStoryGuideFixes(read.body as StoryGuidePayloadV1, (await this.repository.listLive(textKey)).map(toInput));
    const matching = matchingOf(applied.outcomes);
    this.remember(read.sha256, state.revision, matching);
    return matching;
  }

  private remember(sha256: string, revision: number, matching: StoryGuideFixMatching): void {
    const key = `${sha256}:${revision}`;
    this.matchingCache.delete(key);
    this.matchingCache.set(key, matching);
    while (this.matchingCache.size > MATCHING_CACHE_SIZE) this.matchingCache.delete(this.matchingCache.keys().next().value!);
  }
}
