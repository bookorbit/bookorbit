import type {
  BookFileWriteDisabledReason,
  BookFileWriteField,
  BookFileWriteStatus,
  BookFileWriteTargetSkipReason,
  BookFileWriteTargetStatus,
  BookFormat,
} from '@bookorbit/types';
import { BOOK_FORMATS, getBookFileWriteFormatFields } from '@bookorbit/types';
import {
  normalizeWriteFormat,
  resolveWriteTargetSkip,
  selectWriteTargets,
  WRITE_TARGET_SKIP_REASON,
  type FileWriteFormatConfig,
  type WriteTargetFile,
  type WriteTargetMode,
  type WriterSupport,
  type WriteTargetSkipReason,
} from './write-target-selector';

export interface LibraryFileWriteConfig extends FileWriteFormatConfig {
  fileWriteEnabled: boolean;
  fileWriteWriteCover: boolean;
  fileWriteAllFiles: boolean;
}

export type FileWriteCapabilityFile = WriteTargetFile;
export type FileWriteCapabilityLibraryConfig = Partial<LibraryFileWriteConfig> | null | undefined;

const BOOK_FORMAT_SET = new Set<string>(BOOK_FORMATS);

export function writeTargetModeFor(config: { fileWriteAllFiles?: boolean | null } | null | undefined): WriteTargetMode {
  return config?.fileWriteAllFiles === true ? 'all_files' : 'primary';
}

/**
 * What book detail reports about write-back. It asks the same selector the write path uses, so a
 * file shown as a write target is one a write would actually reach.
 */
export function resolveBookFileWriteStatus(
  libraryConfig: FileWriteCapabilityLibraryConfig,
  files: readonly FileWriteCapabilityFile[],
  primaryFileId: number | null,
  supports: WriterSupport,
): BookFileWriteStatus {
  if (!isCompleteLibraryFileWriteConfig(libraryConfig) || !libraryConfig.fileWriteEnabled) {
    return disabledBookFileWriteStatus('library_disabled');
  }

  const mode = writeTargetModeFor(libraryConfig);
  const primaryFile = primaryFileId == null ? null : (files.find((file) => file.id === primaryFileId) ?? null);
  if (!primaryFile && mode === 'primary') return disabledBookFileWriteStatus('no_primary_file');

  const { targets, excluded } = selectWriteTargets({ files, primaryFile, mode, supports });
  const targetStatuses = [
    ...targets.map((file) => buildTargetStatus(file, resolveWriteTargetSkip(file, libraryConfig, supports), libraryConfig)),
    ...excluded.map((file) => buildTargetStatus(file, WRITE_TARGET_SKIP_REASON.notContentFile, libraryConfig)),
  ];
  if (targets.length === 0) return { ...disabledBookFileWriteStatus('no_primary_file'), targets: targetStatuses };

  const writableStatuses = targetStatuses.filter((status) => status.writable && isBookFormat(normalizeWriteFormat(status.format)));
  const writableFormats = unique(writableStatuses.map((status) => normalizeWriteFormat(status.format) as BookFormat));
  if (writableFormats.length > 0) {
    const writableFields = unique(writableStatuses.flatMap((status) => status.writableFields));
    return { enabled: true, reason: null, writableFormats, writableFields, targets: targetStatuses };
  }

  const reasons = targetStatuses.map((status) => status.reason).filter(isBookLevelReason);
  return { ...disabledBookFileWriteStatus(resolveBookFileWriteDisabledReason(reasons)), targets: targetStatuses };
}

export function isCompleteLibraryFileWriteConfig(config: FileWriteCapabilityLibraryConfig): config is LibraryFileWriteConfig {
  if (!config) return false;
  return (
    typeof config.fileWriteEnabled === 'boolean' &&
    typeof config.fileWriteWriteCover === 'boolean' &&
    typeof config.fileWriteAllFiles === 'boolean' &&
    typeof config.fileWriteEpubEnabled === 'boolean' &&
    typeof config.fileWriteEpubMaxFileSizeMb === 'number' &&
    typeof config.fileWriteFb2Enabled === 'boolean' &&
    typeof config.fileWriteFb2MaxFileSizeMb === 'number' &&
    typeof config.fileWritePdfEnabled === 'boolean' &&
    typeof config.fileWritePdfMaxFileSizeMb === 'number' &&
    typeof config.fileWriteCbxEnabled === 'boolean' &&
    typeof config.fileWriteCbxMaxFileSizeMb === 'number' &&
    typeof config.fileWriteKindleEnabled === 'boolean' &&
    typeof config.fileWriteKindleMaxFileSizeMb === 'number' &&
    typeof config.fileWriteAudioEnabled === 'boolean' &&
    typeof config.fileWriteAudioMaxFileSizeMb === 'number' &&
    typeof config.fileWriteReadAlongEnabled === 'boolean' &&
    typeof config.fileWriteReadAlongMaxFileSizeMb === 'number'
  );
}

/** The fields one format can hold, which is what a single file of that format receives. */
export function resolveWritableFieldsForFormat(format: string, config: Pick<LibraryFileWriteConfig, 'fileWriteWriteCover'>): BookFileWriteField[] {
  return getBookFileWriteFormatFields(format).filter((field) => field !== 'coverBytes' || config.fileWriteWriteCover);
}

function buildTargetStatus(
  file: FileWriteCapabilityFile,
  skip: WriteTargetSkipReason | null,
  config: LibraryFileWriteConfig,
): BookFileWriteTargetStatus {
  const format = normalizeWriteFormat(file.format);
  return {
    fileId: file.id,
    format: format || null,
    writable: skip === null,
    reason: skip === null ? null : mapTargetSkipReason(skip),
    writableFields: skip === null ? resolveWritableFieldsForFormat(format, config) : [],
  };
}

function mapTargetSkipReason(reason: WriteTargetSkipReason): BookFileWriteTargetSkipReason {
  switch (reason) {
    case WRITE_TARGET_SKIP_REASON.fileExceedsSizeLimit:
      return 'file_exceeds_size_limit';
    case WRITE_TARGET_SKIP_REASON.formatDisabled:
      return 'format_disabled';
    case WRITE_TARGET_SKIP_REASON.notContentFile:
      return 'not_content_file';
    default:
      return 'format_not_supported';
  }
}

/** Role exclusions are per-file detail; the book-level reason keeps to the values released clients know. */
function isBookLevelReason(reason: BookFileWriteTargetSkipReason | null): reason is Exclude<BookFileWriteTargetSkipReason, 'not_content_file'> {
  return reason !== null && reason !== 'not_content_file';
}

function resolveBookFileWriteDisabledReason(reasons: BookFileWriteDisabledReason[]): BookFileWriteDisabledReason {
  if (reasons.includes('file_exceeds_size_limit')) return 'file_exceeds_size_limit';
  if (reasons.includes('format_disabled')) return 'format_disabled';
  return reasons[0] ?? 'format_not_supported';
}

function disabledBookFileWriteStatus(reason: BookFileWriteDisabledReason): BookFileWriteStatus {
  return { enabled: false, reason, writableFormats: [], writableFields: [] };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isBookFormat(format: string): format is BookFormat {
  return BOOK_FORMAT_SET.has(format);
}
