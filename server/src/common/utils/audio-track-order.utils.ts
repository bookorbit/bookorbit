import { naturalCompare } from './natural-sort.utils';

/**
 * Natural order of a book's files by their whole path. A book's files share its folder, so within
 * one folder this is natural file-name order, and a disc folder (`CD 1`, `CD 2`) keeps its tracks
 * together instead of interleaving them with the next disc's by file name.
 */
export function compareBookFilePaths(leftPath: string, rightPath: string): number {
  return naturalCompare(leftPath, rightPath);
}

export type AudioTrackSpan = { fileId: number; durationSeconds: number | null };

/** Seconds from the start of the book to the start of each track, or null when a length is unknown. */
function trackStarts(order: readonly AudioTrackSpan[]): Map<number, number> | null {
  const starts = new Map<number, number>();
  let elapsed = 0;
  for (const track of order) {
    if (track.durationSeconds === null || !(track.durationSeconds > 0)) return null;
    starts.set(track.fileId, elapsed);
    elapsed += track.durationSeconds;
  }
  return starts;
}

function sameTracks(left: readonly AudioTrackSpan[], right: readonly AudioTrackSpan[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map((track) => track.fileId));
  return rightIds.size === right.length && left.every((track) => rightIds.has(track.fileId));
}

/**
 * Moves an absolute book position recorded under one track order to the same moment of the same
 * track under another order. Null when the orders hold different tracks or a track length is
 * unknown, because the position cannot then be placed in a track.
 */
export function remapAudioBookPosition(positionSeconds: number, previous: readonly AudioTrackSpan[], next: readonly AudioTrackSpan[]): number | null {
  if (previous.length === 0 || !sameTracks(previous, next)) return null;
  const previousStarts = trackStarts(previous);
  const nextStarts = trackStarts(next);
  if (!previousStarts || !nextStarts) return null;

  const position = Math.max(0, positionSeconds);
  let track = previous[previous.length - 1]!;
  for (const candidate of previous) {
    if (position < previousStarts.get(candidate.fileId)! + candidate.durationSeconds!) {
      track = candidate;
      break;
    }
  }
  const offset = Math.min(position - previousStarts.get(track.fileId)!, track.durationSeconds!);
  return nextStarts.get(track.fileId)! + offset;
}

/** Share of the book reached at an offset into one track, 0 to 100, or null when it cannot be placed. */
export function audioBookPercentageAt(order: readonly AudioTrackSpan[], fileId: number, offsetSeconds: number): number | null {
  const starts = trackStarts(order);
  const start = starts?.get(fileId);
  if (start === undefined) return null;
  const total = order.reduce((sum, track) => sum + track.durationSeconds!, 0);
  return Math.max(0, Math.min(100, ((start + Math.max(0, offsetSeconds)) / total) * 100));
}
