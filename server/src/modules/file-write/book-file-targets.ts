import { basename, dirname, extname, join, relative } from 'path';

import { isAudioFormat, resolveUploadPath } from '@bookorbit/types';
import { buildPatternTokens, type PatternTokenMetadata } from '../../common/utils/pattern-tokens.utils';

/** The parts of a book file that decide where it lands. */
export interface TargetBookFile {
  id: number;
  absolutePath: string;
  format: string | null;
  role: string | null;
  sortOrder: number | null;
}

export interface BookFileTargetsInput {
  /** The file whose resolved path represents the book. */
  primaryFileId: number;
  /** Every file the book owns, including the primary one. */
  files: TargetBookFile[];
  metadata: PatternTokenMetadata;
  authors?: string[];
  narrators?: string[];
  libraryName?: string | null;
  libraryFolderPath: string;
  /** The book's folder today, or the primary file's path when it has no folder of its own. */
  bookFolderPath: string;
  organizationMode: string | null;
  pattern: string;
  sanitizeForCrossPlatform: boolean;
}

/**
 * Works out where every file of one book would end up under the naming pattern.
 *
 * This is deliberately the only implementation of that question. The rename preview and the rename
 * itself both have to answer it, and when they answered it separately the preview offered renames
 * the executor then refused: a multi-track audiobook resolves all of its parts onto one filename,
 * so the parts get their `-PartNN` suffix back and the primary file ends up exactly where it
 * started. The preview, looking only at the primary file, could not see the siblings that caused
 * it and reported a rename that could never happen.
 *
 * @returns absolute target path per file id. A book with no resolvable pattern yields an empty map.
 */
export function resolveBookFileTargets(input: BookFileTargetsInput): Map<number, string> {
  const { primaryFileId, files, libraryFolderPath, bookFolderPath, organizationMode } = input;

  const primary = files.find((file) => file.id === primaryFileId);
  if (!primary) return new Map();

  const baseRelPath = resolveRelPathFor(primary, input);
  if (!baseRelPath) return new Map();

  const baseNewAbsolutePath = join(libraryFolderPath, baseRelPath);
  const baseNewFolderPath = dirname(baseNewAbsolutePath);
  const isBookPerFolder = organizationMode === 'book_per_folder';
  const bookHasOwnFolder = isBookPerFolder && bookFolderPath !== primary.absolutePath;

  const relocate = (file: TargetBookFile): string => {
    const relToOldFolder = bookHasOwnFolder ? relative(bookFolderPath, file.absolutePath) : basename(file.absolutePath);
    return join(isBookPerFolder ? baseNewFolderPath : dirname(baseNewAbsolutePath), relToOldFolder);
  };

  const fileTargets = new Map<number, string>();

  for (const file of files) {
    if (file.id === primaryFileId) {
      fileTargets.set(file.id, baseNewAbsolutePath);
      continue;
    }

    if (file.role !== 'content') {
      fileTargets.set(file.id, relocate(file));
      continue;
    }

    const fileRelPath = resolveRelPathFor(file, input);
    if (!fileRelPath) {
      fileTargets.set(file.id, relocate(file));
      continue;
    }

    const resolvedAbs = join(libraryFolderPath, fileRelPath);
    if (!isBookPerFolder) {
      fileTargets.set(file.id, resolvedAbs);
      continue;
    }

    // The primary file lands directly in the book folder, so its siblings go there too. Sending
    // only the primary up used to tear a book apart: files that sat in a sub-folder stayed behind
    // while the primary moved, leaving one unsuffixed track a level above the rest.
    fileTargets.set(file.id, join(baseNewFolderPath, basename(resolvedAbs)));
  }

  applyMultiTrackAudioPartSuffixes(fileTargets, files, primaryFileId);

  if (hasInternalCollision(fileTargets)) {
    // The pattern cannot separate these files, so only the primary one moves and the rest follow it.
    fileTargets.clear();
    fileTargets.set(primaryFileId, baseNewAbsolutePath);
    for (const file of files) {
      if (file.id !== primaryFileId) fileTargets.set(file.id, relocate(file));
    }
  }

  return fileTargets;
}

/** Where the book's primary file lands, which is the path the preview and the rename compare against. */
export function resolvePrimaryFileTarget(input: BookFileTargetsInput): string | null {
  return resolveBookFileTargets(input).get(input.primaryFileId) ?? null;
}

/**
 * Finds a target that another file of the same book currently occupies.
 *
 * Renumbering can shift a whole set of files by one, so each target is held by its neighbour:
 * `Part03` wants `Part02`, `Part04` wants `Part03`, and so on. Performing that in place would
 * overwrite data, so the rename refuses it, and the preview has to refuse it too rather than
 * offering a rename that always comes back as skipped.
 *
 * @returns the occupied target path, or null when every file has somewhere free to go.
 */
export function findSiblingOccupiedTarget(files: TargetBookFile[], targets: Map<number, string>): string | null {
  const occupantByPath = new Map<string, number>();
  for (const file of files) occupantByPath.set(file.absolutePath.toLowerCase(), file.id);

  for (const [fileId, target] of targets) {
    const occupantId = occupantByPath.get(target.toLowerCase());
    if (occupantId !== undefined && occupantId !== fileId) return target;
  }
  return null;
}

function resolveRelPathFor(file: TargetBookFile, input: BookFileTargetsInput): string | null {
  const extension = extname(file.absolutePath);
  const format = (file.format ?? extension.slice(1)).toLowerCase();
  const tokens = buildPatternTokens({
    metadata: input.metadata,
    authors: input.authors,
    narrators: input.narrators,
    originalStem: basename(file.absolutePath, extension),
    format,
    libraryName: input.libraryName,
  });
  return resolveUploadPath(input.pattern, tokens, format, { sanitizeForCrossPlatform: input.sanitizeForCrossPlatform });
}

function isAudioContentFile(file: TargetBookFile, primaryFileId: number): boolean {
  const format = (file.format ?? extname(file.absolutePath).slice(1)).toLowerCase();
  return Boolean(format && isAudioFormat(format) && (file.role === 'content' || file.id === primaryFileId));
}

/**
 * An audiobook's parts usually share every metadata token, so the pattern resolves all of them onto
 * one filename. Restoring a track suffix is what keeps them apart.
 *
 * Numbers run densely inside each colliding set. Numbering across every audio file instead let a
 * file that receives no suffix consume a number, which is how a set of parts ended up starting at
 * `-Part02` with no `-Part01` at all.
 */
function applyMultiTrackAudioPartSuffixes(fileTargets: Map<number, string>, files: TargetBookFile[], primaryFileId: number): void {
  const audioFiles = files.filter((file) => isAudioContentFile(file, primaryFileId));
  if (audioFiles.length < 2) return;

  const audioFilesByTarget = new Map<string, TargetBookFile[]>();
  for (const file of audioFiles) {
    const targetPath = fileTargets.get(file.id);
    if (!targetPath) continue;

    const key = targetPath.toLowerCase();
    const existing = audioFilesByTarget.get(key);
    if (existing) existing.push(file);
    else audioFilesByTarget.set(key, [file]);
  }

  for (const group of audioFilesByTarget.values()) {
    if (group.length < 2) continue;

    [...group].sort(compareAudioTrackFiles).forEach((file, index) => {
      const targetPath = fileTargets.get(file.id);
      if (targetPath) fileTargets.set(file.id, appendPartSuffix(targetPath, index + 1));
    });
  }
}

function hasInternalCollision(fileTargets: Map<number, string>): boolean {
  const seen = new Set<string>();
  for (const targetPath of fileTargets.values()) {
    const key = targetPath.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function compareAudioTrackFiles(a: TargetBookFile, b: TargetBookFile): number {
  const aSortOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bSortOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return aSortOrder - bSortOrder || a.id - b.id;
}

function appendPartSuffix(targetPath: string, trackNumber: number): string {
  const extension = extname(targetPath);
  const stem = basename(targetPath, extension);
  return join(dirname(targetPath), `${stem}-Part${String(trackNumber).padStart(2, '0')}${extension}`);
}
