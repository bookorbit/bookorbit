import { distance } from 'fastest-levenshtein';
import { basename } from 'path';

import type { PodcastImportScope, PodcastImportSignal } from '@bookorbit/types';
import type { PodcastFileNameHints, PodcastFileTags } from './podcast-tag-reader.service';

/**
 * The matcher: everything that decides which episode a file is, expressed as pure functions over
 * plain rows so the whole cascade is testable without a filesystem, a database, or an ffprobe.
 *
 * The service around it owns the I/O and the ordering; this module owns the judgement.
 */

/** A duration is considered equal within the larger of five seconds and two percent. */
const DURATION_TOLERANCE_SECONDS = 5;
const DURATION_TOLERANCE_RATIO = 0.02;
/** Levenshtein distance under which two normalised titles are the same title. */
const TITLE_MAX_DISTANCE = 2;
const TITLE_MIN_SIMILARITY = 0.9;
/** How close a show title has to be before folder or album text is allowed to narrow the search. */
const SHOW_MIN_SIMILARITY = 0.8;
/** Shows a weak title similarity may narrow the episode search to. */
export const MAX_WEAK_SCOPE_SHOWS = 3;
/** How many episodes a single duration or date bucket may return before the signal is abandoned. */
const MAX_BUCKET_SCAN = 200;
export const MAX_MATCH_CANDIDATES = 3;

export interface ImportEpisodeRow {
  episodeId: number;
  podcastId: number;
  podcastTitle: string;
  identityHash: string;
  title: string;
  publishedAt: Date | null;
  durationSeconds: number | null;
  /** Decrypted by the caller; null when the row was read without one. */
  enclosureUrl: string | null;
  mediaStatus: string | null;
  checksum: string | null;
  localSizeBytes: number | null;
}

export interface ImportShowRow {
  id: number;
  title: string;
  /** Null for a local-origin show, which no feed hash can ever point at. */
  feedUrlHash: string | null;
}

export interface PodcastEpisodeIndex {
  podcastId: number;
  byIdentityHash: Map<string, ImportEpisodeRow>;
  byId: Map<number, ImportEpisodeRow>;
  byEnclosureFileName: Map<string, ImportEpisodeRow[]>;
  byPublishedDay: Map<string, ImportEpisodeRow[]>;
  /** Ascending by duration, so a tolerance window is a slice rather than a scan. */
  byDuration: Array<{ seconds: number; episode: ImportEpisodeRow }>;
  size: number;
}

export interface ShowIndex {
  byId: Map<number, ImportShowRow>;
  byFeedHash: Map<string, ImportShowRow>;
  normalizedTitles: Array<{ show: ImportShowRow; normalized: string }>;
}

export interface ShowScopeInput {
  /** Pinned by the caller; already checked to belong to this library. */
  requestedPodcastId: number | null;
  folderPodcastId: number | null;
  folderTitle: string | null;
  feedUrlHashFromTag: string | null;
  feedUrlHashFromSidecar: string | null;
  albumTag: string | null;
}

export interface ShowScopeResult {
  scope: PodcastImportScope;
  podcastIds: number[];
}

export interface EpisodeMatchInput {
  fileName: string;
  tags: PodcastFileTags | null;
  hints: PodcastFileNameHints;
  /** One per show the scope resolved to; empty when no show resolved. */
  scopedIndexes: PodcastEpisodeIndex[];
  /** `sha256(<episode GUID tag>)`, hashed by the caller through the same function the feed writes identities with. */
  guidIdentityHash: string | null;
  /** The library-wide `identity_hash = sha256(guid)` hit, if the file carried an Apple episode GUID. */
  guidEpisode: ImportEpisodeRow | null;
  /** The episode a `[<episodeId>]` file name suffix named, before any consistency check. */
  suffixEpisode: ImportEpisodeRow | null;
  /** Shows the file is allowed to attach into. Empty means "anywhere in the library". */
  scopedPodcastIds: number[];
}

export interface EpisodeMatchCandidate {
  episode: ImportEpisodeRow;
  signals: PodcastImportSignal[];
}

export type EpisodeMatchResult =
  | { kind: 'matched'; tier: 'exact' | 'fuzzy'; episode: ImportEpisodeRow; signals: PodcastImportSignal[] }
  | { kind: 'ambiguous'; reason: 'single_fuzzy_signal' | 'multiple_candidates'; candidates: EpisodeMatchCandidate[] }
  | { kind: 'none' };

export function buildShowIndex(shows: ImportShowRow[], aliases: Array<{ podcastId: number; urlHash: string }>): ShowIndex {
  const byId = new Map(shows.map((show) => [show.id, show]));
  const byFeedHash = new Map<string, ImportShowRow>();
  for (const show of shows) if (show.feedUrlHash !== null) byFeedHash.set(show.feedUrlHash, show);
  for (const alias of aliases) {
    const show = byId.get(alias.podcastId);
    if (show && !byFeedHash.has(alias.urlHash)) byFeedHash.set(alias.urlHash, show);
  }
  return { byId, byFeedHash, normalizedTitles: shows.map((show) => ({ show, normalized: normalizeTitle(show.title) })) };
}

export function buildEpisodeIndex(podcastId: number, rows: ImportEpisodeRow[]): PodcastEpisodeIndex {
  const index: PodcastEpisodeIndex = {
    podcastId,
    byIdentityHash: new Map(),
    byId: new Map(),
    byEnclosureFileName: new Map(),
    byPublishedDay: new Map(),
    byDuration: [],
    size: rows.length,
  };
  for (const row of rows) {
    index.byIdentityHash.set(row.identityHash, row);
    index.byId.set(row.episodeId, row);
    const enclosureFileName = enclosureFileNameOf(row.enclosureUrl);
    if (enclosureFileName) push(index.byEnclosureFileName, enclosureFileName, row);
    if (row.publishedAt) push(index.byPublishedDay, dayKey(row.publishedAt), row);
    if (row.durationSeconds !== null && row.durationSeconds > 0) index.byDuration.push({ seconds: row.durationSeconds, episode: row });
  }
  index.byDuration.sort((left, right) => left.seconds - right.seconds);
  return index;
}

/**
 * Which show a file belongs to, strongest evidence first. A folder's `[<podcastId>]` suffix is only
 * honoured when the folder's title still matches that show: after a database reset the same suffix
 * points at whatever show now holds that id, which would be a confident wrong answer.
 */
export function resolveShowScope(index: ShowIndex, input: ShowScopeInput): ShowScopeResult {
  if (input.requestedPodcastId !== null && index.byId.has(input.requestedPodcastId)) {
    return { scope: 'request', podcastIds: [input.requestedPodcastId] };
  }
  const folderShow = input.folderPodcastId === null ? undefined : index.byId.get(input.folderPodcastId);
  if (folderShow && titlesAgree(input.folderTitle, folderShow.title)) {
    return { scope: 'folder_suffix', podcastIds: [folderShow.id] };
  }
  const tagShow = input.feedUrlHashFromTag === null ? undefined : index.byFeedHash.get(input.feedUrlHashFromTag);
  if (tagShow) return { scope: 'feed_url_tag', podcastIds: [tagShow.id] };
  const sidecarShow = input.feedUrlHashFromSidecar === null ? undefined : index.byFeedHash.get(input.feedUrlHashFromSidecar);
  if (sidecarShow) return { scope: 'feed_sidecar', podcastIds: [sidecarShow.id] };

  const similar = findSimilarShows(index, [input.albumTag, input.folderTitle]);
  if (similar.length > 0) return { scope: 'title_similarity', podcastIds: similar };
  return { scope: 'library', podcastIds: [] };
}

function findSimilarShows(index: ShowIndex, texts: Array<string | null>): number[] {
  const scored = new Map<number, number>();
  for (const text of texts) {
    const normalized = normalizeTitle(text ?? '');
    if (!normalized) continue;
    for (const entry of index.normalizedTitles) {
      const score = similarity(normalized, entry.normalized);
      if (score < SHOW_MIN_SIMILARITY) continue;
      scored.set(entry.show.id, Math.max(scored.get(entry.show.id) ?? 0, score));
    }
  }
  return [...scored.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, MAX_WEAK_SCOPE_SHOWS)
    .map(([podcastId]) => podcastId);
}

/**
 * The episode cascade. Exact signals adopt on their own; a fuzzy signal needs a second one that
 * agrees, and anything short of that is handed to the review UI rather than guessed at.
 */
export function matchEpisode(input: EpisodeMatchInput): EpisodeMatchResult {
  const signalsByEpisode = new Map<number, { episode: ImportEpisodeRow; signals: Set<PodcastImportSignal> }>();
  const record = (episode: ImportEpisodeRow, signal: PodcastImportSignal) => {
    if (!isInScope(episode, input.scopedPodcastIds)) return;
    const existing = signalsByEpisode.get(episode.episodeId);
    if (existing) existing.signals.add(signal);
    else signalsByEpisode.set(episode.episodeId, { episode, signals: new Set([signal]) });
  };

  if (input.guidEpisode) record(input.guidEpisode, 'episode_guid');
  // An id in a file name only means something while the id space it was written against still
  // holds: it counts once the surrounding folder or feed tag has independently named the show.
  if (input.suffixEpisode && input.scopedPodcastIds.includes(input.suffixEpisode.podcastId)) {
    record(input.suffixEpisode, 'episode_id_suffix');
  }

  const fileName = basename(input.fileName);
  const normalizedFileTitle = normalizeTitle(input.tags?.title ?? input.hints.title ?? '');
  const publishedAt = input.tags?.publishedAt ?? input.hints.publishedAt;
  const duration = input.tags?.durationSeconds ?? null;

  for (const index of input.scopedIndexes) {
    if (input.guidIdentityHash) {
      const byGuid = index.byIdentityHash.get(input.guidIdentityHash);
      if (byGuid) record(byGuid, 'episode_guid');
    }
    for (const episode of index.byEnclosureFileName.get(fileName.toLowerCase()) ?? []) record(episode, 'enclosure_file_name');
    if (normalizedFileTitle) {
      for (const episode of episodesNearDate(index, publishedAt)) {
        if (titleMatches(normalizedFileTitle, episode.title)) record(episode, 'title_and_date');
      }
      for (const episode of episodesNearDuration(index, duration)) {
        if (titleMatches(normalizedFileTitle, episode.title)) record(episode, 'title_and_duration');
      }
    }
  }

  const candidates = [...signalsByEpisode.values()].map((entry) => ({ episode: entry.episode, signals: orderSignals(entry.signals) }));
  if (candidates.length === 0) return { kind: 'none' };

  const exact = candidates.filter((candidate) => candidate.signals.some(isExactSignal));
  if (exact.length === 1) return { kind: 'matched', tier: 'exact', episode: exact[0]!.episode, signals: exact[0]!.signals };
  if (exact.length > 1) return { kind: 'ambiguous', reason: 'multiple_candidates', candidates: topCandidates(exact) };

  const agreeing = candidates.filter((candidate) => candidate.signals.length >= 2);
  if (agreeing.length === 1) return { kind: 'matched', tier: 'fuzzy', episode: agreeing[0]!.episode, signals: agreeing[0]!.signals };
  if (agreeing.length > 1) return { kind: 'ambiguous', reason: 'multiple_candidates', candidates: topCandidates(agreeing) };

  return {
    kind: 'ambiguous',
    reason: candidates.length === 1 ? 'single_fuzzy_signal' : 'multiple_candidates',
    candidates: topCandidates(candidates),
  };
}

function topCandidates(candidates: EpisodeMatchCandidate[]): EpisodeMatchCandidate[] {
  return [...candidates]
    .sort((left, right) => right.signals.length - left.signals.length || left.episode.episodeId - right.episode.episodeId)
    .slice(0, MAX_MATCH_CANDIDATES);
}

function isInScope(episode: ImportEpisodeRow, scopedPodcastIds: number[]): boolean {
  return scopedPodcastIds.length === 0 || scopedPodcastIds.includes(episode.podcastId);
}

function isExactSignal(signal: PodcastImportSignal): boolean {
  return signal === 'episode_guid' || signal === 'episode_id_suffix' || signal === 'enclosure_file_name' || signal === 'manual';
}

const SIGNAL_ORDER: PodcastImportSignal[] = [
  'manual',
  'episode_guid',
  'episode_id_suffix',
  'enclosure_file_name',
  'title_and_date',
  'title_and_duration',
];

function orderSignals(signals: Set<PodcastImportSignal>): PodcastImportSignal[] {
  return SIGNAL_ORDER.filter((signal) => signals.has(signal));
}

function episodesNearDate(index: PodcastEpisodeIndex, publishedAt: Date | null): ImportEpisodeRow[] {
  if (!publishedAt) return [];
  const found: ImportEpisodeRow[] = [];
  for (const offset of [-1, 0, 1]) {
    const day = new Date(publishedAt.getTime() + offset * 86_400_000);
    for (const episode of index.byPublishedDay.get(dayKey(day)) ?? []) {
      if (found.length >= MAX_BUCKET_SCAN) return [];
      found.push(episode);
    }
  }
  return found;
}

function episodesNearDuration(index: PodcastEpisodeIndex, durationSeconds: number | null): ImportEpisodeRow[] {
  if (durationSeconds === null || durationSeconds <= 0 || index.byDuration.length === 0) return [];
  const tolerance = Math.max(DURATION_TOLERANCE_SECONDS, durationSeconds * DURATION_TOLERANCE_RATIO);
  const found: ImportEpisodeRow[] = [];
  for (let position = lowerBound(index.byDuration, durationSeconds - tolerance); position < index.byDuration.length; position++) {
    const entry = index.byDuration[position]!;
    if (entry.seconds > durationSeconds + tolerance) break;
    if (found.length >= MAX_BUCKET_SCAN) return [];
    found.push(entry.episode);
  }
  return found;
}

function lowerBound(entries: Array<{ seconds: number }>, target: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entries[middle]!.seconds < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** True when a file's title and an episode's title are the same title under normalisation. */
export function titleMatches(normalizedFileTitle: string, episodeTitle: string): boolean {
  const normalizedEpisodeTitle = normalizeTitle(episodeTitle);
  if (!normalizedFileTitle || !normalizedEpisodeTitle) return false;
  if (normalizedFileTitle === normalizedEpisodeTitle) return true;
  if (distance(normalizedFileTitle, normalizedEpisodeTitle) <= TITLE_MAX_DISTANCE) return true;
  return similarity(normalizedFileTitle, normalizedEpisodeTitle) >= TITLE_MIN_SIMILARITY;
}

function titlesAgree(left: string | null, right: string): boolean {
  const normalizedLeft = normalizeTitle(left ?? '');
  if (!normalizedLeft) return false;
  return similarity(normalizedLeft, normalizeTitle(right)) >= SHOW_MIN_SIMILARITY;
}

/**
 * Case, accent, and punctuation folded, across scripts: the class-based strip would erase a
 * Cyrillic or CJK title entirely, so punctuation and symbols are what is removed, not everything
 * outside the Latin alphabet.
 */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  return 1 - distance(left, right) / Math.max(left.length, right.length);
}

/** The enclosure's own file name: percent-decoded, query and fragment stripped, lower-cased. */
export function enclosureFileNameOf(enclosureUrl: string | null): string | null {
  if (!enclosureUrl) return null;
  let pathname: string;
  try {
    pathname = new URL(enclosureUrl).pathname;
  } catch {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const name = basename(decoded).trim().toLowerCase();
  return name.length > 0 ? name : null;
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
