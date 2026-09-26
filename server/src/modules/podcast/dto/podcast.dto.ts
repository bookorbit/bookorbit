import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import {
  PODCAST_BULK_DELETE_MAX_SHOWS,
  PODCAST_CREATE_SOURCES,
  PODCAST_DIRECTORY_SEARCH_MAX_QUERY,
  PODCAST_DIRECTORY_SEARCH_MAX_RESULTS,
  PODCAST_EPISODE_LOCKED_FIELDS,
  PODCAST_EPISODE_MAX_CHAPTERS,
  PODCAST_EPISODE_MAX_DURATION_SECONDS,
  PODCAST_EPISODE_TYPES,
  PODCAST_IMPORT_MAX_RESOLUTIONS,
  PODCAST_LOCKED_FIELDS,
  PODCAST_MAX_CATEGORIES,
  PODCAST_PLAYLIST_MAX_SHOWS,
  PODCAST_PLAYLIST_QUEUE_LIMIT,
  PODCAST_STATE_BATCH_LIMIT,
} from '@bookorbit/types';
import type {
  PodcastAcquisitionPolicy,
  PodcastCreateSource,
  PodcastDownloadCleanup,
  PodcastEpisodeFilter,
  PodcastEpisodeLockedField,
  PodcastEpisodeType,
  PodcastLockedField,
  PodcastNotificationMode,
  PodcastPlaylistSort,
  PodcastQueuePlacement,
  PodcastSort,
} from '@bookorbit/types';

const acquisitionPolicies: PodcastAcquisitionPolicy[] = ['remote_only', 'manual', 'newest', 'window'];
const podcastCreateSources: string[] = [...PODCAST_CREATE_SOURCES];
const downloadCleanupModes: PodcastDownloadCleanup[] = ['keep', 'after_finished'];
const episodeFilters: PodcastEpisodeFilter[] = ['latest', 'downloaded', 'in_progress', 'unplayed', 'finished', 'pinned'];
const episodeSorts: PodcastPlaylistSort[] = ['newest', 'oldest', 'shortest', 'longest', 'recently_listened'];
const podcastSorts: PodcastSort[] = ['title', 'recent', 'unplayed'];
const notificationModes: PodcastNotificationMode[] = ['off', 'immediate', 'daily', 'weekly'];
const queuePlacements: PodcastQueuePlacement[] = ['end', 'next'];
const podcastLockedFields: string[] = [...PODCAST_LOCKED_FIELDS];
const podcastEpisodeLockedFields: string[] = [...PODCAST_EPISODE_LOCKED_FIELDS];
const podcastEpisodeTypes: string[] = [...PODCAST_EPISODE_TYPES];

/**
 * Query strings carry booleans as text. Only the four spellings below are understood; anything else
 * is handed back untouched so the `@IsBoolean()` that follows rejects it with a 400.
 *
 * The previous form was `value === 'true'`, which quietly answered `false` for every other input.
 * A client sending `followedOnly=1` then received a complete, unfiltered result set that looked
 * like a valid answer, with nothing anywhere to say the filter had been dropped.
 */
function booleanValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}

function integerValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  return Number(value);
}

/** Query strings carry id lists as `1,2,3` or as repeated params; both arrive here. */
function integerList(value: unknown): unknown {
  if (typeof value === 'string') {
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.map((part) => Number(part));
  }
  if (Array.isArray(value)) return value.map((entry) => integerValue(entry));
  return value;
}

function isDefined(_: unknown, value: unknown): boolean {
  return value !== undefined;
}

export class PodcastFeedUrlDto {
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(8192)
  feedUrl!: string;
}

/**
 * The one way content enters a podcast library, from either direction. `source` picks the arm:
 * `feed` subscribes to an address, `folder` adopts audio already sitting in the library folder.
 *
 * Validation cannot express "these fields belong to the other arm", because a skipped `ValidateIf`
 * leaves the value in place rather than rejecting it. `assertPodcastCreateSource` does that part,
 * so a folder request carrying a refresh cadence is refused instead of silently storing a setting
 * that can never fire.
 */
export class CreatePodcastDto {
  @IsIn(podcastCreateSources)
  source!: PodcastCreateSource;

  @ValidateIf((dto: CreatePodcastDto) => dto.source === 'feed')
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(8192)
  feedUrl?: string;

  /** Relative to the library folder, exactly as the import report publishes it. */
  @ValidateIf((dto: CreatePodcastDto) => dto.source === 'folder')
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  folderPath?: string;

  @ValidateIf(isDefined)
  @IsIn(acquisitionPolicies)
  acquisitionPolicy?: PodcastAcquisitionPolicy;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(1)
  @Max(10_000)
  autoDownloadLimit?: number;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(1)
  @Max(3650)
  autoDownloadWindowDays?: number;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(5)
  @Max(10080)
  refreshIntervalMinutes?: number;
}

const PODCAST_FEED_ONLY_FIELDS = ['feedUrl', 'acquisitionPolicy', 'autoDownloadLimit', 'autoDownloadWindowDays', 'refreshIntervalMinutes'] as const;

/** Rejects the fields belonging to the arm the request did not pick. */
export function assertPodcastCreateSource(dto: CreatePodcastDto): void {
  if (dto.source === 'feed') {
    if (dto.folderPath !== undefined) throw new BadRequestException('folderPath is not valid for a feed podcast');
    return;
  }
  const strays = PODCAST_FEED_ONLY_FIELDS.filter((field) => dto[field] !== undefined);
  if (strays.length > 0) throw new BadRequestException(`${strays.join(', ')} ${strays.length === 1 ? 'is' : 'are'} not valid for a folder podcast`);
}

/** Page, size and search shared by every podcast list query. Pages are 0-based, as everywhere else in the app. */
export class PodcastPageQueryDto {
  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(0)
  page = 0;

  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(100)
  size = 24;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  q?: string;
}

export class ListPodcastsDto extends PodcastPageQueryDto {
  @IsOptional()
  @Transform(({ value }) => booleanValue(value))
  @IsBoolean()
  archived = false;
}

export class ListPodcastShowsDto extends ListPodcastsDto {
  @IsOptional()
  @IsIn(podcastSorts)
  sort: PodcastSort = 'title';

  /**
   * Narrows to local shows whose folder is gone. Unlike `archived` this is not a mode: false leaves
   * the list alone rather than excluding the missing shows, so the default view still holds them.
   */
  @IsOptional()
  @Transform(({ value }) => booleanValue(value))
  @IsBoolean()
  missing = false;

  /** Lets a client resolve a bounded set of shows, such as the shows a saved playlist targets, in one request. */
  @IsOptional()
  @Transform(({ value }) => integerList(value))
  @IsArray()
  @ArrayMaxSize(PODCAST_PLAYLIST_MAX_SHOWS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  podcastIds?: number[];
}

/** Everything that narrows an episode match. Shared by the episode list and by bulk queueing from the same rules. */
export class PodcastEpisodeRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  q?: string;

  @IsOptional()
  @IsIn(episodeFilters)
  filter: PodcastEpisodeFilter = 'latest';

  @IsOptional()
  @IsIn(episodeSorts)
  sort: PodcastPlaylistSort = 'newest';

  @IsOptional()
  @IsISO8601({ strict: true })
  publishedFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  publishedTo?: string;

  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(3650)
  publishedWithinDays?: number;

  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  podcastId?: number;

  @IsOptional()
  @Transform(({ value }) => integerList(value))
  @IsArray()
  @ArrayMaxSize(PODCAST_PLAYLIST_MAX_SHOWS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  podcastIds?: number[];

  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(1440)
  minDurationMinutes?: number;

  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(1440)
  maxDurationMinutes?: number;

  @IsOptional()
  @Transform(({ value }) => booleanValue(value))
  @IsBoolean()
  followedOnly = false;
}

export class ListPodcastEpisodesDto extends PodcastEpisodeRuleDto {
  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(0)
  page = 0;

  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(100)
  size = 24;
}

export class QueuePodcastEpisodesDto extends PodcastEpisodeRuleDto {
  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(PODCAST_PLAYLIST_QUEUE_LIMIT)
  limit: number = PODCAST_PLAYLIST_QUEUE_LIMIT;
}

/**
 * Sparse show metadata update. Every property present is written and then added to the stored lock
 * set, because a feed refresh overwrites anything unlocked within the hour. `lockedFields` is the
 * authoritative set before that union, so unlocking a field means sending `lockedFields` without it
 * and without sending the field value.
 */
export class UpdatePodcastMetadataDto {
  @ValidateIf(isDefined)
  @IsString()
  @MaxLength(1000)
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  author?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100_000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, disallow_auth: true })
  @MaxLength(8192)
  siteUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  language?: string | null;

  @ValidateIf(isDefined)
  @IsBoolean()
  explicit?: boolean;

  @ValidateIf(isDefined)
  @IsArray()
  @ArrayMaxSize(PODCAST_MAX_CATEGORIES)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  categories?: string[];

  @ValidateIf(isDefined)
  @IsArray()
  @ArrayMaxSize(30)
  @IsIn(podcastLockedFields, { each: true })
  lockedFields?: PodcastLockedField[];
}

export class PodcastChapterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsNumber()
  @Min(0)
  @Max(PODCAST_EPISODE_MAX_DURATION_SECONDS)
  startSeconds!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(PODCAST_EPISODE_MAX_DURATION_SECONDS)
  endSeconds?: number;

  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, disallow_auth: true })
  @MaxLength(8192)
  url?: string;
}

/**
 * Sparse episode metadata update, with the same lock-on-edit contract as the show endpoint. Only
 * the fields the refresh upsert guards per lock are accepted: `guid`, the enclosure fields and
 * `transcripts` are identity and delivery data the feed owns, so `forbidNonWhitelisted` rejects
 * them rather than letting an edit be silently dropped by the next refresh.
 */
export class UpdatePodcastEpisodeMetadataDto {
  @ValidateIf(isDefined)
  @IsString()
  @MaxLength(2000)
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(10_000)
  subtitle?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100_000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  @MaxLength(50)
  publishedAt?: string | null;

  /** Varchars in the schema, not numbers: feeds publish arbitrary text such as `2` or `Series 2`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  season?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  episode?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(podcastEpisodeTypes)
  episodeType?: PodcastEpisodeType | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @IsPositive()
  @Max(PODCAST_EPISODE_MAX_DURATION_SECONDS)
  durationSeconds?: number | null;

  @ValidateIf(isDefined)
  @IsBoolean()
  explicit?: boolean;

  @ValidateIf(isDefined)
  @IsArray()
  @ArrayMaxSize(PODCAST_EPISODE_MAX_CHAPTERS)
  @ValidateNested({ each: true })
  @Type(() => PodcastChapterDto)
  chapters?: PodcastChapterDto[];

  @ValidateIf(isDefined)
  @IsArray()
  @ArrayMaxSize(30)
  @IsIn(podcastEpisodeLockedFields, { each: true })
  lockedFields?: PodcastEpisodeLockedField[];
}

export class UploadPodcastArtworkFromUrlDto {
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, disallow_auth: true })
  @MaxLength(8192)
  url!: string;
}

export class UpdatePodcastConfigDto {
  @ValidateIf(isDefined)
  @IsIn(acquisitionPolicies)
  acquisitionPolicy?: PodcastAcquisitionPolicy;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(10_000)
  autoDownloadLimit?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(3650)
  autoDownloadWindowDays?: number | null;

  @ValidateIf(isDefined)
  @IsIn(downloadCleanupModes)
  downloadCleanup?: PodcastDownloadCleanup;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(0)
  @Max(8760)
  downloadCleanupDelayHours?: number;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(5)
  @Max(10080)
  refreshIntervalMinutes?: number;
}

export class UpdatePodcastLibrarySettingsDto {
  @ValidateIf(isDefined)
  @IsString()
  @MaxLength(30)
  storageQuotaBytes?: string;

  @ValidateIf(isDefined)
  @IsString()
  @MaxLength(30)
  minimumFreeSpaceBytes?: string;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(5)
  @Max(10080)
  defaultRefreshIntervalMinutes?: number;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(0)
  @Max(3600)
  completionRemainingSeconds?: number;
}

export class FollowPodcastDto {
  @IsIn(notificationModes)
  notificationMode: PodcastNotificationMode = 'off';
}

export class UpdateEpisodeStateDto {
  @ValidateIf(isDefined)
  @IsNumber()
  @Min(0)
  positionSeconds?: number;

  @ValidateIf(isDefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  progressPercent?: number;

  @ValidateIf(isDefined)
  @IsBoolean()
  finished?: boolean;

  @ValidateIf(isDefined)
  @IsBoolean()
  pinned?: boolean;

  /**
   * When the client captured this state. A write older than the stored row is discarded, so a
   * device draining an offline queue cannot clobber newer progress made on another device.
   */
  @ValidateIf(isDefined)
  @IsISO8601()
  capturedAt?: string;
}

export class PodcastEpisodeStateBatchDto {
  @IsArray()
  @ArrayMaxSize(PODCAST_STATE_BATCH_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  episodeIds!: number[];
}

export class ReorderPodcastQueueDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  episodeIds!: number[];
}

export class RestorePodcastQueueDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  episodeIds!: number[];
}

/** Single-row move. `position` is a 0-based target index the service clamps to the queue length. */
export class MovePodcastQueueDto {
  @IsInt()
  @Min(1)
  episodeId!: number;

  @IsInt()
  @Min(0)
  @Max(999)
  position!: number;
}

export class DownloadLatestPodcastEpisodesDto {
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;
}

export class ListPodcastQueueDto extends PodcastPageQueryDto {
  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(100)
  size = 50;
}

/** Query for the cross-library resume feed. Deliberately small: this feeds a home row, not a list screen. */
export class ListPodcastContinueDto {
  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(50)
  size = 10;
}

export class QueuePodcastEpisodeDto {
  @ValidateIf(isDefined)
  @IsIn(queuePlacements)
  placement: PodcastQueuePlacement = 'end';

  @ValidateIf(isDefined)
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  afterEpisodeId?: number;
}

export class CreatePodcastBookmarkDto {
  @IsNumber()
  @Min(0)
  positionSeconds!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ValidateIf(isDefined)
  @IsString()
  @MaxLength(10_000)
  note?: string;
}

export class UpdatePodcastBookmarkDto {
  @ValidateIf(isDefined)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(10_000)
  note?: string | null;
}

export class CreatePodcastSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sessionId!: string;

  @IsISO8601()
  @MaxLength(50)
  startedAt!: string;

  @IsISO8601()
  @MaxLength(50)
  endedAt!: string;

  @IsNumber()
  @Min(0)
  endPositionSeconds!: number;
}

export class PodcastOpmlImportDto {
  @IsString()
  @MaxLength(5_000_000)
  opml!: string;

  @ValidateIf(isDefined)
  @IsIn(acquisitionPolicies)
  acquisitionPolicy?: PodcastAcquisitionPolicy;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(1)
  @Max(10_000)
  autoDownloadLimit?: number;

  @ValidateIf(isDefined)
  @IsInt()
  @Min(1)
  @Max(3650)
  autoDownloadWindowDays?: number;
}

/** One review-UI decision, carried back with the apply run: adopt this file as this episode. */
export class PodcastImportResolutionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  path!: string;

  @IsInt()
  @Min(1)
  episodeId!: number;
}

export class PodcastImportScanDto {
  /** Defaults to a dry run: a scan the user did not explicitly apply must not write. */
  @IsOptional()
  @IsBoolean()
  dryRun = true;

  /** Narrows the whole run to one show, for a user who already knows where the files belong. */
  @ValidateIf(isDefined)
  @IsInt()
  @Min(1)
  podcastId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PODCAST_IMPORT_MAX_RESOLUTIONS)
  @ValidateNested({ each: true })
  @Type(() => PodcastImportResolutionDto)
  resolutions?: PodcastImportResolutionDto[];
}

/** Query for `GET /podcast-search`. The term is a directory lookup, not an in-library filter. */
export class SearchPodcastDirectoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(PODCAST_DIRECTORY_SEARCH_MAX_QUERY)
  q!: string;

  @IsOptional()
  @Transform(({ value }) => integerValue(value))
  @IsInt()
  @Min(1)
  @Max(PODCAST_DIRECTORY_SEARCH_MAX_RESULTS)
  limit = 25;
}

/** Query for `GET /podcast-libraries/:libraryId/opml/export`. Both flags widen what the export covers. */
export class ExportPodcastOpmlDto {
  @IsOptional()
  @Transform(({ value }) => booleanValue(value))
  @IsBoolean()
  includePrivate = false;

  @IsOptional()
  @Transform(({ value }) => booleanValue(value))
  @IsBoolean()
  includeArchived = false;
}

/** Body for the bulk purge preview and the bulk delete: the shows a selection names, bounded. */
export class BulkDeletePodcastShowsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(PODCAST_BULK_DELETE_MAX_SHOWS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  podcastIds!: number[];
}

export class PodcastMergeDto {
  @IsInt()
  @Min(1)
  sourcePodcastId!: number;
}
