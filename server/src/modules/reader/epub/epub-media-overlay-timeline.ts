import type { EpubMediaOverlayPlaylistItem } from '@bookorbit/types';

export const READ_ALOUD_MAX_DURATION_DIFF_RATIO = 0.05;
export const READ_ALOUD_MAX_DURATION_DIFF_SECONDS = 300;

type TimelineItem = Pick<EpubMediaOverlayPlaylistItem, 'audioHref' | 'clipBeginSeconds' | 'clipEndSeconds' | 'durationSeconds'>;

export interface AudioTimelineTrack {
  href: string;
  startSeconds: number;
  spanSeconds: number;
}

/**
 * The audio a read-along EPUB carries, laid end to end in the order its sentences first use each
 * track. Its length is what the audiobook's length is compared with. The narration clock the
 * playlist keeps counts only the clipped sentences, so pauses, music and unaligned audio between
 * them are missing from it and a book built from a whole audiobook always reads shorter.
 */
export interface AudioTimeline {
  tracks: AudioTimelineTrack[];
  totalSeconds: number;
}

export function readAloudDurationsMatch(audioSeconds: number, timelineSeconds: number): boolean {
  if (!(timelineSeconds > 0)) return false;
  const tolerance = Math.min(READ_ALOUD_MAX_DURATION_DIFF_SECONDS, timelineSeconds * READ_ALOUD_MAX_DURATION_DIFF_RATIO);
  return Math.abs(audioSeconds - timelineSeconds) <= tolerance;
}

export function buildAudioTimeline(items: readonly TimelineItem[]): AudioTimeline | null {
  const spans = new Map<string, number>();
  for (const item of items) {
    const reach = Math.max(item.clipBeginSeconds, item.clipEndSeconds ?? 0);
    if (!Number.isFinite(reach)) continue;
    spans.set(item.audioHref, Math.max(spans.get(item.audioHref) ?? 0, reach));
  }

  const tracks: AudioTimelineTrack[] = [];
  let totalSeconds = 0;
  for (const [href, spanSeconds] of spans) {
    tracks.push({ href, startSeconds: totalSeconds, spanSeconds });
    totalSeconds += spanSeconds;
  }
  return totalSeconds > 0 ? { tracks, totalSeconds } : null;
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The sentence a point on the narration clock falls in, and where that sentence starts on it. A
 * point past the last sentence takes the last one.
 */
export function locateItemByNarratedSeconds<T extends Pick<EpubMediaOverlayPlaylistItem, 'durationSeconds'>>(
  items: readonly T[],
  narratedSeconds: number,
): { item: T; startSeconds: number } | null {
  let elapsed = 0;
  let last: { item: T; startSeconds: number } | null = null;

  for (const item of items) {
    const duration = item.durationSeconds;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration <= 0) continue;
    const start = elapsed;
    const end = isPositiveFinite(duration) ? start + duration : null;

    if (narratedSeconds <= start || end == null || narratedSeconds < end) return { item, startSeconds: start };

    last = { item, startSeconds: start };
    elapsed = end;
  }

  return last;
}

/** Where a point on the narration clock sits on the audio timeline. */
export function narratedSecondsToTimelineSeconds(items: readonly TimelineItem[], timeline: AudioTimeline, narratedSeconds: number): number | null {
  const located = locateItemByNarratedSeconds(items, narratedSeconds);
  if (!located) return null;
  const track = timeline.tracks.find((candidate) => candidate.href === located.item.audioHref);
  if (!track) return null;

  const within = Math.min(Math.max(0, narratedSeconds - located.startSeconds), located.item.durationSeconds ?? 0);
  return Math.min(timeline.totalSeconds, track.startSeconds + located.item.clipBeginSeconds + within);
}

/**
 * Where a point on the audio timeline sits on the narration clock. A point inside a sentence lands
 * inside it; one in a pause lands where the pause ends on the clock, which is the start of the
 * sentence about to be spoken.
 */
export function timelineSecondsToNarratedSeconds(items: readonly TimelineItem[], timeline: AudioTimeline, timelineSeconds: number): number | null {
  const track = timeline.tracks.findLast((candidate) => candidate.startSeconds <= timelineSeconds) ?? timeline.tracks[0];
  if (!track) return null;
  const local = Math.max(0, timelineSeconds - track.startSeconds);

  let elapsed = 0;
  let found: { item: TimelineItem; startSeconds: number } | null = null;
  for (const item of items) {
    const duration = item.durationSeconds;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration <= 0) continue;
    const start = elapsed;
    if (isPositiveFinite(duration)) elapsed += duration;

    if (item.audioHref !== track.href) continue;
    if (found && item.clipBeginSeconds > local) break;
    found = { item, startSeconds: start };
  }
  if (!found) return null;

  const into = Math.min(Math.max(0, local - found.item.clipBeginSeconds), found.item.durationSeconds ?? 0);
  return Math.min(elapsed, found.startSeconds + into);
}
