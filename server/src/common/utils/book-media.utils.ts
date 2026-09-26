import { getBookMediaProfile, type CoverMedia, type CoverMedium } from '@bookorbit/types';

type BookMediaFileRow = { format: string | null; role: string };

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
 */
export function resolveIsAudiobook(files: readonly BookMediaFileRow[] | undefined, meta: AudiobookMetadataSignals | null | undefined): boolean {
  const primaryMediaKind = files?.length ? getBookMediaProfile(files).primaryMediaKind : 'unknown';
  if (primaryMediaKind !== 'unknown') return primaryMediaKind === 'audiobook';
  return meta?.durationSeconds != null || !!meta?.audibleId || !!meta?.librofmId;
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
