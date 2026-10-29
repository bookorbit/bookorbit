import {
  getBookMediaKind,
  getBookMediaProfile,
  isAudioFormat,
  type ConcreteBookMediaKind,
  type CoverMedia,
  type CoverMedium,
} from '@bookorbit/types';

import { compareBookFilePaths } from './audio-track-order.utils';

type BookMediaFileRow = { id?: number; format: string | null; role: string };

/** What a metadata fetch needs to know about a book's cover slots. */
export type CoverFetchState = {
  media: CoverMedia;
  filled: Record<CoverMedium, boolean>;
  locked: CoverMedium[];
};

type AudiobookMetadataSignals = {
  durationSeconds?: number | null;
  audibleId?: string | null;
  librofmId?: string | null;
};

/**
 * Media type of the book itself, for flows that must ask a provider for the right edition.
 * Files are authoritative; the audio metadata signals only fill in when no file states a format.
 *
 * `primaryFileId` is the file the library's format priority chose, which is what decides for a
 * book holding an EPUB and an M4B. Without it the first content file stood in, and that is only
 * path order: a ReadAloud+ book led with its EPUB because "Dune.epub" sorts before "Dune.m4b".
 */
export function resolveIsAudiobook(
  files: readonly BookMediaFileRow[] | undefined,
  meta: AudiobookMetadataSignals | null | undefined,
  primaryFileId?: number | null,
): boolean {
  const primary = primaryFileId == null ? undefined : files?.find((file) => file.id === primaryFileId);
  const primaryMediaKind = primary ? getBookMediaKind(primary.format) : files?.length ? getBookMediaProfile(files).primaryMediaKind : 'unknown';
  if (primaryMediaKind !== 'unknown') return primaryMediaKind === 'audiobook';
  return meta?.durationSeconds != null || !!meta?.audibleId || !!meta?.librofmId;
}

/**
 * What the book is read as, leaving any audio aside: a comic when its readable files are comics, an
 * ebook otherwise. A manga in EPUB is an ebook here, since only its format is known. Undefined when
 * no readable file states a format.
 */
export function resolveTextMediaKind(files: readonly BookMediaFileRow[] | undefined, primaryFileId?: number | null): 'ebook' | 'comic' | undefined {
  const primary = primaryFileId == null ? undefined : files?.find((file) => file.id === primaryFileId);
  const primaryKind = primary ? getBookMediaKind(primary.format) : undefined;
  if (primaryKind === 'ebook' || primaryKind === 'comic') return primaryKind;
  const kinds = (files ?? []).filter((file) => file.role === 'content' || file.role === 'primary').map((file) => getBookMediaKind(file.format));
  if (kinds.includes('ebook')) return 'ebook';
  if (kinds.includes('comic')) return 'comic';
  return undefined;
}

/** The medium a metadata search is run as: the audiobook when it is for the audio side, else the book's reading medium. */
export function resolveSearchMediaKind(
  files: readonly BookMediaFileRow[] | undefined,
  isAudiobook: boolean,
  primaryFileId?: number | null,
): ConcreteBookMediaKind | undefined {
  return isAudiobook ? 'audiobook' : resolveTextMediaKind(files, primaryFileId);
}

/** The pipeline's view of the slots: each is an existing field when filled, and locked slots are skipped. */
export function coverFetchInputs(state: CoverFetchState): {
  existing: { cover: true | null; audioCover: true | null };
  options: { coverMedia: CoverMedia; lockedCoverSlots: CoverMedium[] };
} {
  return {
    existing: { cover: state.filled.ebook ? true : null, audioCover: state.filled.audio ? true : null },
    options: { coverMedia: state.media, lockedCoverSlots: state.locked },
  };
}

type AudioTrackOrderRow = { sortOrder?: number | null; absolutePath: string };

/** Playback order of an audiobook's tracks: explicit sort order first, unset last, then natural path. */
export function compareAudioTracks(left: AudioTrackOrderRow, right: AudioTrackOrderRow): number {
  const byOrder = (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (byOrder !== 0) return byOrder;
  return compareBookFilePaths(left.absolutePath, right.absolutePath);
}

export type TrackOrderFileRow = { id: number; absolutePath: string; format: string | null; sortOrder: number | null };

/**
 * The sort orders that put a book's audio tracks back in natural path order, which is the order
 * the Files tab shows and the one a scan of the whole folder writes. Each writer numbers only the
 * files it handles: an upload that adds a track leaves it unset, an import that joins a book
 * numbers its own files from zero, and a scan that started before newer files arrived numbers the
 * folder as it was. The player follows the stored numbers, so any of them can scramble playback.
 *
 * A book is left alone while every track has its own number and the numbers rise in path order.
 * Two names natural order cannot tell apart, such as `track1` and `track01`, may come in either
 * order, as a scan leaves them. Otherwise each track takes its rank among all of the book's files
 * by path, which is what a scan writes, so the next scan finds nothing to change. Returns only the
 * tracks whose number changes.
 */
export function planAudioTrackOrderRepair(files: readonly TrackOrderFileRow[]): Array<{ id: number; sortOrder: number }> {
  const tracks = files.filter((file) => file.format !== null && isAudioFormat(file.format));
  if (tracks.length < 2 || playsInPathOrder(tracks)) return [];

  const rankById = new Map([...files].sort(compareFilesByPath).map((file, rank) => [file.id, rank]));
  return tracks.filter((track) => track.sortOrder !== rankById.get(track.id)).map((track) => ({ id: track.id, sortOrder: rankById.get(track.id)! }));
}

function playsInPathOrder(tracks: readonly TrackOrderFileRow[]): boolean {
  if (tracks.some((track) => track.sortOrder === null)) return false;
  const stored = [...tracks].sort((left, right) => left.sortOrder! - right.sortOrder!);
  return stored.every((track, index) => {
    const previous = stored[index - 1];
    return !previous || (track.sortOrder! > previous.sortOrder! && compareBookFilePaths(previous.absolutePath, track.absolutePath) <= 0);
  });
}

/** Natural path order, made total so a repair numbers the same files the same way every time. */
function compareFilesByPath(left: TrackOrderFileRow, right: TrackOrderFileRow): number {
  return (
    compareBookFilePaths(left.absolutePath, right.absolutePath) ||
    (left.absolutePath < right.absolutePath ? -1 : left.absolutePath > right.absolutePath ? 1 : 0)
  );
}
