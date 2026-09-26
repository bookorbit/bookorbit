import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';

import { PODCAST_EPISODE_LOCKED_FIELDS } from '@bookorbit/types';
import type {
  PodcastBookmark,
  PodcastBulkActionResult,
  PodcastEpisodeListItem,
  PodcastEpisodeStateRow,
  PodcastEpisodeSummary,
  PodcastPlaybackContext,
  PodcastQueueClearResult,
  PodcastQueueRestoreResult,
} from '@bookorbit/types';
import { assertOffsetWithinLimit } from '../../common/constants/pagination.constants';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import type {
  CreatePodcastBookmarkDto,
  CreatePodcastSessionDto,
  ListPodcastContinueDto,
  ListPodcastQueueDto,
  MovePodcastQueueDto,
  QueuePodcastEpisodeDto,
  QueuePodcastEpisodesDto,
  ReorderPodcastQueueDto,
  RestorePodcastQueueDto,
  UpdateEpisodeStateDto,
  UpdatePodcastBookmarkDto,
  UpdatePodcastEpisodeMetadataDto,
} from './dto/podcast.dto';
import { sanitizePodcastHtml } from './podcast-html-sanitizer';
import { PodcastAccessService } from './podcast-access.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastGateway } from './podcast.gateway';
import { PodcastPlaybackRepository } from './podcast-playback.repository';
import { mergePodcastLockedFields, normalizePodcastChapters } from './podcast-metadata-rules';

@Injectable()
export class PodcastPlaybackService {
  private readonly logger = new Logger(PodcastPlaybackService.name);

  constructor(
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly playback: PodcastPlaybackRepository,
    private readonly libraries: LibraryService,
    private readonly gateway: PodcastGateway,
    private readonly access: PodcastAccessService,
  ) {}

  async queueEpisodesFromRules(libraryId: number, user: RequestUser, query: QueuePodcastEpisodesDto): Promise<PodcastBulkActionResult> {
    await this.access.requirePodcastLibrary(libraryId);
    const { limit, ...rules } = query;
    const result = await this.playback.addQueryEpisodesToQueue(user.id, libraryId, rules, limit);
    return {
      completed: result.added,
      failed: 0,
      skipped: result.skipped,
      ...(result.firstEpisodeId ? { firstEpisodeId: result.firstEpisodeId } : {}),
    };
  }

  async queueAllPodcastEpisodes(podcastId: number, user: RequestUser): Promise<PodcastBulkActionResult> {
    await this.access.requirePodcastAccess(podcastId, user);
    const result = await this.playback.addPodcastEpisodesToQueue(user.id, podcastId);
    return {
      completed: result.added,
      failed: 0,
      skipped: result.skipped,
      ...(result.firstEpisodeId ? { firstEpisodeId: result.firstEpisodeId } : {}),
    };
  }

  async markAllPodcastEpisodesPlayed(podcastId: number, user: RequestUser): Promise<PodcastBulkActionResult> {
    await this.access.requirePodcastAccess(podcastId, user);
    const completed = await this.playback.markPodcastEpisodesFinished(user.id, podcastId);
    return { completed, failed: 0, skipped: 0 };
  }

  async getEpisode(episodeId: number, user: RequestUser) {
    await this.access.requireEpisodeAccess(episodeId, user);
    const summary = await this.episodes.findEpisodeSummary(episodeId, user.id);
    if (!summary) throw new NotFoundException('Podcast episode not found');
    return summary;
  }

  /**
   * Sparse episode metadata write, locking every edited field the way the show endpoint does.
   * An episode that has dropped out of the feed is editable on purpose: fixing the title of an
   * unavailable back-catalogue entry is one of the reasons to edit an episode at all.
   */

  async updateEpisodeMetadata(episodeId: number, dto: UpdatePodcastEpisodeMetadataDto, user: RequestUser): Promise<PodcastEpisodeSummary> {
    if (Object.values(dto).every((value) => value === undefined)) throw new BadRequestException('Podcast episode metadata update is empty');
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) throw new BadRequestException('Podcast episode title cannot be empty');
    const publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    if (publishedAt && Number.isNaN(publishedAt.getTime())) throw new BadRequestException('publishedAt is not a valid timestamp');
    const context = await this.access.requireEpisodeAccess(episodeId, user, 'editor');
    const values = {
      ...(dto.title === undefined ? {} : { title }),
      ...(dto.subtitle === undefined ? {} : { subtitle: dto.subtitle?.trim() || null }),
      ...(dto.description === undefined ? {} : { description: sanitizePodcastHtml(dto.description) }),
      ...(dto.publishedAt === undefined ? {} : { publishedAt }),
      ...(dto.season === undefined ? {} : { season: dto.season?.trim() || null }),
      ...(dto.episode === undefined ? {} : { episode: dto.episode?.trim() || null }),
      ...(dto.episodeType === undefined ? {} : { episodeType: dto.episodeType }),
      ...(dto.durationSeconds === undefined ? {} : { durationSeconds: dto.durationSeconds }),
      ...(dto.explicit === undefined ? {} : { explicit: dto.explicit }),
      ...(dto.chapters === undefined ? {} : { chapters: normalizePodcastChapters(dto.chapters) }),
    };
    const updated = await this.episodes.updateEpisodeMetadata(
      episodeId,
      values,
      mergePodcastLockedFields(PODCAST_EPISODE_LOCKED_FIELDS, context.episode.lockedFields, dto.lockedFields, Object.keys(values)),
    );
    if (!updated) throw new NotFoundException('Podcast episode not found');
    const summary = await this.episodes.findEpisodeSummary(episodeId, user.id);
    if (!summary) throw new NotFoundException('Podcast episode not found');
    return summary;
  }

  async getPlaybackContext(episodeId: number, user: RequestUser): Promise<PodcastPlaybackContext> {
    const context = await this.access.requireEpisodeAccess(episodeId, user);
    const episode = await this.episodes.findEpisodeSummary(episodeId, user.id);
    if (!episode) throw new NotFoundException('Podcast episode not found');
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    const queue = await this.playback.findQueuePlaybackContext(user.id, episodeId, accessibleLibraryIds);

    if (queue.position !== null) {
      return {
        episode,
        queue,
        navigation: {
          source: 'queue',
          previous: queue.previous,
          next: queue.upcoming[0] ?? null,
        },
      };
    }

    const adjacent = await this.episodes.findAdjacentEpisodeSummaries(context.episode, user.id);
    return {
      episode,
      queue,
      navigation: {
        source: adjacent.previous || adjacent.next ? 'podcast' : null,
        previous: adjacent.previous,
        next: adjacent.next,
      },
    };
  }

  async updateEpisodeState(episodeId: number, user: RequestUser, dto: UpdateEpisodeStateDto) {
    const { capturedAt: rawCapturedAt, ...changes } = dto;
    if (Object.values(changes).every((value) => value === undefined)) throw new BadRequestException('Podcast episode state update is empty');
    const capturedAt = rawCapturedAt === undefined ? undefined : new Date(rawCapturedAt);
    if (capturedAt !== undefined && Number.isNaN(capturedAt.getTime())) throw new BadRequestException('capturedAt is not a valid timestamp');
    const context = await this.access.requireEpisodeAccess(episodeId, user);
    const settings = await this.catalog.getLibrarySettings(context.podcast.libraryId);
    const duration = context.episode.durationSeconds;
    // A feed's declared duration is a claim, not a measurement: a show with dynamically inserted
    // ads routinely ships a file minutes longer than its tag says. A reported position past that
    // claim is evidence the claim is short, so the position stands. Truncating it here used to
    // throw away the listener's real place and then read as 100% complete, which sent the next
    // load back to the start of the episode.
    const durationCoversPosition =
      duration !== null && duration > 0 && (changes.positionSeconds === undefined || changes.positionSeconds <= duration);
    const positionSeconds =
      changes.finished === false && changes.positionSeconds === undefined
        ? 0
        : changes.finished === true && changes.positionSeconds === undefined && duration !== null
          ? duration
          : changes.positionSeconds;
    const progressPercent =
      positionSeconds === undefined
        ? changes.finished === false
          ? 0
          : changes.progressPercent
        : durationCoversPosition
          ? Math.min(100, (positionSeconds / duration!) * 100)
          : // Only the player knows how long the media really runs, so its own figure is the honest
            // one whenever the stored duration has just been contradicted.
            changes.progressPercent;
    const normalizedProgressPercent = changes.finished === true ? 100 : progressPercent;
    let finished = changes.finished;
    if (
      finished === undefined &&
      positionSeconds !== undefined &&
      durationCoversPosition &&
      duration! - positionSeconds <= settings.completionRemainingSeconds
    ) {
      finished = true;
    }
    return this.playback.upsertEpisodeState(
      user.id,
      episodeId,
      {
        ...changes,
        positionSeconds,
        progressPercent: normalizedProgressPercent,
        finished,
        finishedAt: finished === true ? new Date() : finished === false ? null : undefined,
        lastListenedAt: positionSeconds !== undefined && positionSeconds > 0 ? new Date() : undefined,
      },
      capturedAt,
    );
  }

  async listEpisodeStates(user: RequestUser, episodeIds: number[]): Promise<PodcastEpisodeStateRow[]> {
    const unique = [...new Set(episodeIds)];
    if (unique.length === 0) return [];
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    const rows = await this.playback.listEpisodeStates(user.id, unique, accessibleLibraryIds);
    return rows.map((row) => ({
      episodeId: row.episodeId,
      positionSeconds: row.positionSeconds,
      progressPercent: row.progressPercent,
      finished: row.finished,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      pinned: row.pinned,
      lastListenedAt: row.lastListenedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** One call for every library the user can reach, so a home screen resume row costs one request. */

  async listContinueListening(user: RequestUser, query: ListPodcastContinueDto): Promise<PodcastEpisodeListItem[]> {
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    return this.playback.listContinueListening(user.id, query.size, accessibleLibraryIds);
  }

  async addQueueItem(episodeId: number, user: RequestUser, dto: QueuePodcastEpisodeDto) {
    await this.access.requireEpisodeAccess(episodeId, user);
    const result = await this.playback.addQueueItem(user.id, episodeId, dto.placement, dto.afterEpisodeId);
    if (result === 'full') throw new BadRequestException('Podcast queue cannot contain more than 1000 episodes');
    if (result === 'missing_anchor') throw new BadRequestException('The requested queue position is no longer available');
  }

  async removeQueueItem(episodeId: number, user: RequestUser) {
    await this.access.requireEpisodeAccess(episodeId, user);
    await this.playback.removeQueueItem(user.id, episodeId);
  }

  async reorderQueue(user: RequestUser, dto: ReorderPodcastQueueDto) {
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    const reordered = await this.playback.reorderQueue(user.id, dto.episodeIds, accessibleLibraryIds);
    if (!reordered) throw new BadRequestException('Queue reorder contains an inaccessible, missing, or duplicate episode');
  }

  /**
   * Moves one entry to a 0-based index, clamped to the queue's length. Unlike the full-set reorder
   * this carries no client snapshot of the membership, so a drag on one device cannot undo an edit
   * another device made in the meantime.
   */

  async moveQueueItem(user: RequestUser, dto: MovePodcastQueueDto) {
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    const moved = await this.playback.moveQueueItem(user.id, dto.episodeId, dto.position, accessibleLibraryIds);
    if (!moved) throw new BadRequestException('The episode is no longer in the queue');
  }

  async listQueue(user: RequestUser, query: ListPodcastQueueDto) {
    // The queue was the one podcast list that answered an absurd offset with an empty page instead
    // of the 400 every sibling gives.
    assertOffsetWithinLimit(query.page, query.size);
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    return this.playback.listQueue(user.id, query, accessibleLibraryIds);
  }

  async restoreQueue(user: RequestUser, dto: RestorePodcastQueueDto): Promise<PodcastQueueRestoreResult> {
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    const restored = await this.playback.restoreQueue(user.id, dto.episodeIds, accessibleLibraryIds);
    this.logger.log(
      `[podcast.queue_restore] [end] userId=${user.id} requested=${dto.episodeIds.length} restored=${restored} - podcast queue restore completed`,
    );
    return { restored };
  }

  async clearQueue(user: RequestUser): Promise<PodcastQueueClearResult> {
    const startedAt = Date.now();
    this.logger.log(`[podcast.queue_clear] [start] userId=${user.id} - podcast queue clear started`);
    try {
      const result = await this.playback.clearQueue(user.id);
      this.logger.log(
        `[podcast.queue_clear] [end] userId=${user.id} durationMs=${Date.now() - startedAt} removed=${result.removed} - podcast queue clear completed`,
      );
      return result;
    } catch (reason) {
      const errorClass = reason instanceof Error ? reason.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(reason instanceof Error ? reason.message : 'Unknown error');
      this.logger.error(
        `[podcast.queue_clear] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - podcast queue clear failed`,
      );
      throw reason;
    }
  }

  async clearFinishedQueue(user: RequestUser): Promise<PodcastQueueClearResult> {
    const startedAt = Date.now();
    this.logger.log(`[podcast.queue_clear_finished] [start] userId=${user.id} - finished podcast queue clear started`);
    try {
      const result = await this.playback.clearFinishedQueue(user.id);
      this.logger.log(
        `[podcast.queue_clear_finished] [end] userId=${user.id} durationMs=${Date.now() - startedAt} removed=${result.removed} - finished podcast queue clear completed`,
      );
      return result;
    } catch (reason) {
      const errorClass = reason instanceof Error ? reason.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(reason instanceof Error ? reason.message : 'Unknown error');
      this.logger.error(
        `[podcast.queue_clear_finished] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - finished podcast queue clear failed`,
      );
      throw reason;
    }
  }

  async createBookmark(episodeId: number, user: RequestUser, dto: CreatePodcastBookmarkDto): Promise<PodcastBookmark> {
    const context = await this.access.requireEpisodeAccess(episodeId, user);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Podcast bookmark title cannot be empty');
    const positionSeconds =
      context.episode.durationSeconds === null ? dto.positionSeconds : Math.min(dto.positionSeconds, context.episode.durationSeconds);
    const bookmark = await this.playback.createBookmark(user.id, episodeId, positionSeconds, title, dto.note?.trim() || null);
    if (!bookmark) throw new BadRequestException('An episode cannot contain more than 1000 bookmarks');
    return toPodcastBookmark(bookmark);
  }

  async listBookmarks(episodeId: number, user: RequestUser): Promise<PodcastBookmark[]> {
    await this.access.requireEpisodeAccess(episodeId, user);
    const bookmarks = await this.playback.listBookmarks(user.id, episodeId);
    return bookmarks.map(toPodcastBookmark);
  }

  async deleteBookmark(bookmarkId: number, user: RequestUser) {
    await this.access.requireBookmarkAccess(bookmarkId, user);
    return this.playback.deleteBookmark(user.id, bookmarkId);
  }

  async updateBookmark(bookmarkId: number, user: RequestUser, dto: UpdatePodcastBookmarkDto): Promise<PodcastBookmark> {
    if (dto.title === undefined && dto.note === undefined) throw new BadRequestException('Podcast bookmark update is empty');
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) throw new BadRequestException('Podcast bookmark title cannot be empty');
    await this.access.requireBookmarkAccess(bookmarkId, user);
    const bookmark = await this.playback.updateBookmark(user.id, bookmarkId, {
      title,
      note: dto.note === undefined ? undefined : dto.note?.trim() || null,
    });
    if (!bookmark) throw new NotFoundException('Podcast bookmark not found');
    return toPodcastBookmark(bookmark);
  }

  async createListeningSession(episodeId: number, user: RequestUser, dto: CreatePodcastSessionDto) {
    const context = await this.access.requireEpisodeAccess(episodeId, user);
    const sessionId = dto.sessionId.trim();
    if (!sessionId) throw new BadRequestException('Listening session ID cannot be empty');
    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt < startedAt) {
      throw new BadRequestException('Listening session timestamps are invalid');
    }
    if (endedAt.getTime() - startedAt.getTime() > 24 * 60 * 60_000 || endedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('Listening session duration is invalid');
    }
    const endPositionSeconds =
      context.episode.durationSeconds === null ? dto.endPositionSeconds : Math.min(dto.endPositionSeconds, context.episode.durationSeconds);
    await this.playback.createListeningSession(user.id, episodeId, sessionId, startedAt, endedAt, endPositionSeconds);
  }
}

/** The stored row carries `Date`s; the wire contract is ISO strings. */
function toPodcastBookmark(row: {
  id: number;
  episodeId: number;
  positionSeconds: number;
  title: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PodcastBookmark {
  return {
    id: row.id,
    episodeId: row.episodeId,
    positionSeconds: row.positionSeconds,
    title: row.title,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
