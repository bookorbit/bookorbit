import { basename, dirname, extname, relative, sep } from 'path';

import type { CoverMedium } from '@bookorbit/types';
import { isAudioFormat } from '@bookorbit/types';
import { compareAudioTracks } from '../../common/utils/book-media.utils';
import { isReadAlongBookFile } from '../../common/utils/primary-file-selection.utils';
import {
  AUDIO_WRITE_FORMATS,
  FORMAT_AZW,
  FORMAT_AZW3,
  FORMAT_CB7,
  FORMAT_CBZ,
  FORMAT_EPUB,
  FORMAT_FB2,
  FORMAT_MOBI,
  FORMAT_PDF,
} from './file-write.constants';
import type { FormatWriteOptions } from './interfaces/format-write-options.interface';

/**
 * Which files of a book receive its metadata.
 *
 * This is the only implementation of that question. The write path, the capability reported on
 * book detail, and the Files tab indicator all read it, so they cannot disagree about a file.
 *
 * Six concerns are kept apart on purpose, because they used to be one tangle that was only correct
 * while every target list was homogeneous: target membership, writer support, format enablement,
 * size eligibility, cover medium, and audio grouping. Membership and grouping never consult the
 * writer registry; support, enablement, and size only decide whether a member is skipped.
 */

/** `primary` is the behaviour every library had before the opt-in existed. */
export type WriteTargetMode = 'primary' | 'all_files';

export interface WriteTargetFile {
  id: number;
  format: string | null;
  sizeBytes: number | null;
  role?: string | null;
  absolutePath?: string;
  sortOrder?: number | null;
  mediaOverlayAvailable?: boolean | null;
}

export const WRITE_TARGET_SKIP_REASON = {
  formatNotSupported: 'format not supported',
  formatDisabled: 'format disabled',
  fileExceedsSizeLimit: 'file exceeds size limit',
  notContentFile: 'not a content file',
} as const;

export type WriteTargetSkipReason = (typeof WRITE_TARGET_SKIP_REASON)[keyof typeof WRITE_TARGET_SKIP_REASON];

export type WriterSupport = (format: string) => boolean;

export interface FileWriteFormatConfig {
  fileWriteEpubEnabled: boolean;
  fileWriteEpubMaxFileSizeMb: number;
  fileWriteFb2Enabled: boolean;
  fileWriteFb2MaxFileSizeMb: number;
  fileWritePdfEnabled: boolean;
  fileWritePdfMaxFileSizeMb: number;
  fileWriteCbxEnabled: boolean;
  fileWriteCbxMaxFileSizeMb: number;
  fileWriteKindleEnabled: boolean;
  fileWriteKindleMaxFileSizeMb: number;
  fileWriteAudioEnabled: boolean;
  fileWriteAudioMaxFileSizeMb: number;
  fileWriteReadAlongEnabled: boolean;
  fileWriteReadAlongMaxFileSizeMb: number;
}

export interface WriteTargetSelection<T extends WriteTargetFile> {
  /** Files the book writes to, in write order. Members may still be skipped for support, enablement, or size. */
  targets: T[];
  /** Files left out because of their role, listed only where a writer could otherwise have touched them. */
  excluded: T[];
}

export interface SelectWriteTargetsInput<T extends WriteTargetFile> {
  /** Every file the book owns that the caller has loaded. In `primary` mode an ebook primary alone is enough. */
  files: readonly T[];
  primaryFile: T | null;
  mode: WriteTargetMode;
  /** Only decides which role-excluded files are worth reporting; it never changes membership. */
  supports: WriterSupport;
}

export type AudioTrackContext = Pick<FormatWriteOptions, 'trackNumber' | 'trackTotal' | 'trackTitle' | 'isMultiTrackAudio' | 'preserveTrackIdentity'>;

export function selectWriteTargets<T extends WriteTargetFile>(input: SelectWriteTargetsInput<T>): WriteTargetSelection<T> {
  const { files, mode, supports } = input;
  const primary = input.primaryFile ? (files.find((file) => file.id === input.primaryFile!.id) ?? input.primaryFile) : null;

  if (mode === 'primary') {
    return { targets: selectPrimaryModeTargets(files, primary), excluded: [] };
  }

  const primaryId = primary?.id ?? null;
  const members = files.filter((file) => isContentOrPrimary(file, primaryId));
  if (primary && !members.some((file) => file.id === primary.id)) members.push(primary);

  const excluded = files.filter((file) => {
    if (isContentOrPrimary(file, primaryId)) return false;
    const format = normalizeWriteFormat(file.format);
    return Boolean(format) && supports(format);
  });

  return { targets: members.sort(compareWriteTargets), excluded: excluded.sort(compareWriteTargets) };
}

/**
 * Whether selection needs the book's full file list. An ebook primary in `primary` mode writes only
 * itself, so loading every other file of the book would be wasted work on the hot path.
 */
export function needsBookFileList(primaryFile: Pick<WriteTargetFile, 'format'> | null, mode: WriteTargetMode): boolean {
  return mode === 'all_files' || primaryFile == null || hasAudioFormat(primaryFile.format);
}

/**
 * An ebook primary writes itself. An audio primary writes every audio track of the recording,
 * falling back to itself when the book lists none.
 */
function selectPrimaryModeTargets<T extends WriteTargetFile>(files: readonly T[], primary: T | null): T[] {
  if (!primary) return [];
  if (!hasAudioFormat(primary.format)) return [primary];

  const tracks = files.filter((file) => hasAudioFormat(file.format) && isContentOrPrimary(file, primary.id));
  return tracks.length > 0 ? tracks.sort(compareWriteTargets) : [primary];
}

/**
 * Supplements are distinct works: a companion workbook must not inherit the main book's title and
 * series. Cover and metadata sidecars are not books at all. The primary file is the book, whatever
 * role it was scanned with.
 */
function isContentOrPrimary(file: WriteTargetFile, primaryId: number | null): boolean {
  return file.id === primaryId || file.role === 'content';
}

/**
 * Write order follows playback order, so a track number written into a file names the position the
 * player gives it. The id tie-break keeps the order stable when neither sort order nor name differs.
 */
export function compareWriteTargets(left: WriteTargetFile, right: WriteTargetFile): number {
  const byPlayback = compareAudioTracks(
    { sortOrder: left.sortOrder ?? null, absolutePath: left.absolutePath ?? '' },
    { sortOrder: right.sortOrder ?? null, absolutePath: right.absolutePath ?? '' },
  );
  return byPlayback || left.id - right.id;
}

export function resolveWriteTargetSkip(
  file: Pick<WriteTargetFile, 'format' | 'sizeBytes' | 'mediaOverlayAvailable'>,
  config: FileWriteFormatConfig,
  supports: WriterSupport,
): WriteTargetSkipReason | null {
  const format = normalizeWriteFormat(file.format);
  if (!isWriterSupported(format, supports)) return WRITE_TARGET_SKIP_REASON.formatNotSupported;

  const settings = isReadAlongBookFile(file) ? readAlongWriteSettings(config) : resolveFormatWriteSettings(config, format);
  if (!settings.enabled) return WRITE_TARGET_SKIP_REASON.formatDisabled;

  if (!isWithinSizeLimit(file.sizeBytes, settings.maxFileSizeBytes)) return WRITE_TARGET_SKIP_REASON.fileExceedsSizeLimit;

  return null;
}

export function isWriterSupported(format: string, supports: WriterSupport): boolean {
  return Boolean(format) && supports(format);
}

/** Recorded sizes lag external changes, and an unknown size is treated as empty. */
function isWithinSizeLimit(sizeBytes: number | null, maxFileSizeBytes: number): boolean {
  return (sizeBytes ?? 0) <= maxFileSizeBytes;
}

export function resolveFormatWriteSettings(config: FileWriteFormatConfig, format: string): { enabled: boolean; maxFileSizeBytes: number } {
  switch (format) {
    case FORMAT_EPUB:
      return { enabled: config.fileWriteEpubEnabled, maxFileSizeBytes: megabytes(config.fileWriteEpubMaxFileSizeMb) };
    case FORMAT_FB2:
      return { enabled: config.fileWriteFb2Enabled, maxFileSizeBytes: megabytes(config.fileWriteFb2MaxFileSizeMb) };
    case FORMAT_PDF:
      return { enabled: config.fileWritePdfEnabled, maxFileSizeBytes: megabytes(config.fileWritePdfMaxFileSizeMb) };
    case FORMAT_CBZ:
    case FORMAT_CB7:
      return { enabled: config.fileWriteCbxEnabled, maxFileSizeBytes: megabytes(config.fileWriteCbxMaxFileSizeMb) };
    case FORMAT_MOBI:
    case FORMAT_AZW3:
    case FORMAT_AZW:
      return { enabled: config.fileWriteKindleEnabled, maxFileSizeBytes: megabytes(config.fileWriteKindleMaxFileSizeMb) };
    default:
      if (AUDIO_WRITE_FORMATS.includes(format as (typeof AUDIO_WRITE_FORMATS)[number])) {
        return { enabled: config.fileWriteAudioEnabled, maxFileSizeBytes: megabytes(config.fileWriteAudioMaxFileSizeMb) };
      }
      return { enabled: false, maxFileSizeBytes: 0 };
  }
}

/**
 * Read-along EPUBs embed their narration, so they run to hundreds of megabytes and every rewrite
 * holds the archive in memory. They have their own toggle and limit instead of the EPUB ones.
 */
function readAlongWriteSettings(config: FileWriteFormatConfig): { enabled: boolean; maxFileSizeBytes: number } {
  return { enabled: config.fileWriteReadAlongEnabled, maxFileSizeBytes: megabytes(config.fileWriteReadAlongMaxFileSizeMb) };
}

/** Each file takes artwork from its own medium's cover slot only. */
export function coverMediumForFormat(format: string | null | undefined): CoverMedium {
  return hasAudioFormat(format) ? 'audio' : 'ebook';
}

/**
 * Track identity for the audio members of a target list.
 *
 * Grouping comes from the target list, never from what is writable: an unsupported or oversized
 * track keeps its position, so its siblings' numbers do not shift when it cannot be rewritten.
 *
 * An audio primary makes the book an audiobook, and its audio files are the tracks of one recording,
 * as playback already treats them. Without an audio primary nothing says whether several audio
 * files are tracks or complete alternative editions, so each keeps its own title and track tags
 * rather than becoming a numbered part of an invented recording. A single rewritable audio file is
 * the whole recording either way and takes the book title.
 */
export function resolveAudioTrackContexts(
  targets: readonly (WriteTargetFile & { absolutePath: string })[],
  primaryFile: Pick<WriteTargetFile, 'format'> | null,
): Map<number, AudioTrackContext> {
  const tracks = targets.filter((target) => hasAudioFormat(target.format));
  // Positions count every track, but whether this is a multi-track recording at all is decided as it
  // always was: by the tracks an audio writer can rewrite. One M4B beside an Opus copy is far more
  // likely two editions than two halves, and it has always taken the book title.
  const rewritableTrackCount = tracks.filter((track) => isAudioWriteFormat(track.format)).length;
  const isMultiTrackAudio = rewritableTrackCount > 1;
  const groupingIsAuthoritative = !isMultiTrackAudio || (primaryFile != null && hasAudioFormat(primaryFile.format));

  if (!groupingIsAuthoritative) {
    return new Map(tracks.map((track) => [track.id, { preserveTrackIdentity: true }]));
  }

  const sharedFolder = sharedParentFolder(tracks.map((track) => dirname(track.absolutePath)));
  return new Map(
    tracks.map((track, index) => {
      const trackNumber = index + 1;
      return [
        track.id,
        { trackNumber, trackTotal: tracks.length, trackTitle: resolveTrackTitle(track.absolutePath, trackNumber, sharedFolder), isMultiTrackAudio },
      ];
    }),
  );
}

export function normalizeWriteFormat(format: string | null | undefined): string {
  return (format ?? '').toLowerCase();
}

function hasAudioFormat(format: string | null | undefined): boolean {
  const normalized = normalizeWriteFormat(format);
  return Boolean(normalized) && isAudioFormat(normalized);
}

/** Audio formats the audio writer handles. A fixed list, so grouping never depends on runtime registry state. */
function isAudioWriteFormat(format: string | null | undefined): boolean {
  return AUDIO_WRITE_FORMATS.includes(normalizeWriteFormat(format) as (typeof AUDIO_WRITE_FORMATS)[number]);
}

function megabytes(value: number): number {
  return value * 1024 * 1024;
}

/**
 * A track is titled by its file name. When the tracks of a recording sit in more than one folder,
 * such as `CD 1/01.mp3` and `CD 2/01.mp3`, the folder leads the title, or every disc would repeat
 * the same names.
 */
function resolveTrackTitle(filePath: string, trackNumber: number, sharedFolder: string | null): string {
  const fileName = basename(filePath);
  const extension = extname(fileName);
  const stem = (extension ? fileName.slice(0, -extension.length) : fileName).trim();
  const title = stem || `Part ${String(trackNumber).padStart(2, '0')}`;
  const subfolder = sharedFolder == null ? '' : relative(sharedFolder, dirname(filePath));
  return subfolder ? `${subfolder.split(sep).join(' - ')} - ${title}` : title;
}

/** The deepest folder holding every track, or null when they all sit in one folder. */
function sharedParentFolder(folders: readonly string[]): string | null {
  if (new Set(folders).size < 2) return null;
  let shared = folders[0]!.split(sep);
  for (const folder of folders.slice(1)) {
    const parts = folder.split(sep);
    let index = 0;
    while (index < shared.length && index < parts.length && shared[index] === parts[index]) index++;
    shared = shared.slice(0, index);
  }
  return shared.join(sep) || sep;
}
