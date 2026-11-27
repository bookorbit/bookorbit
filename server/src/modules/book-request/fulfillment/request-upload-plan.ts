import type {
  BookRequestUploadFileInput,
  BookRequestUploadFileRole,
  BookRequestUploadPlan,
  BookRequestUploadPlanFile,
  BookRequestUploadPlanStatus,
  BookRequestUploadPlanUnit,
  BookRequestUploadSkipReason,
} from '@bookorbit/types';
import { bookRequestUploadSet } from '@bookorbit/types';
import { BadRequestException } from '@nestjs/common';

import type { FileRole } from '../../scanner/lib/classify';
import {
  interpretRelease,
  isContinuationVolume,
  RELEASE_FORMAT_RANK,
  type ReleaseIgnoredReason,
  type ReleaseMediaKind,
  type ReleaseUnit,
} from '../../scanner/lib/release-plan';

/** The import walks this many folders below the release, so a file deeper than this is never read. */
const MAX_FOLDER_DEPTH = 4;
const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const FORBIDDEN_SEGMENT_CHARACTERS = /[\\:*?"<>|]/;

export interface RequestUploadPlanContext {
  mediaKind: ReleaseMediaKind;
  title: string;
  maxFileSizeBytes: number;
  /** The same per-name cleaning an upload session applies to its filename. */
  sanitizeName: (name: string) => string;
}

/** One picked file, with the path the attempt stores it at once the picked folder is stripped. */
export interface PlannedUploadFile extends BookRequestUploadPlanFile {
  releasePath: string;
}

export interface PlannedUpload {
  plan: BookRequestUploadPlan;
  files: PlannedUploadFile[];
}

/**
 * What a set of picked files comes to, decided from names and sizes before a byte is sent.
 *
 * The rules are the import's own, read through the same interpreter: a downloaded release and an
 * uploaded one cannot be judged differently, or an upload accepted here would be refused once its
 * files were on disk. What this adds is the request: which of the books it found the request can
 * be closed with, and which files the upload therefore leaves out.
 */
export function planRequestUpload(input: BookRequestUploadFileInput[], context: RequestUploadPlanContext): PlannedUpload {
  const normalized = input.map((file) => ({ path: normalizeUploadPath(file.path, context.sanitizeName), sizeBytes: file.sizeBytes }));
  const seen = new Set<string>();
  for (const file of normalized) {
    if (seen.has(file.path)) throw new BadRequestException(`"${file.path}" was picked twice`);
    seen.add(file.path);
  }

  const rootName = commonRoot(normalized.map((file) => file.path));
  const files = normalized.map((file) => ({ ...file, releasePath: rootName ? file.path.slice(rootName.length + 1) : file.path }));

  const considered = files.filter((file) => file.sizeBytes > 0 && folderDepth(file.releasePath) <= MAX_FOLDER_DEPTH);
  const release = interpretRelease(
    considered.map((file) => ({ path: file.releasePath, sizeBytes: file.sizeBytes })),
    { rootName },
  );

  const units = release.units.map((unit, index) => planUnit(unit, index, context));
  const containers = new Set(release.containers.map((container) => container.path));
  const ignored = new Map(release.ignored.map((entry) => [entry.path, entry.reason]));
  const unitOf = new Map<string, { index: number; role: FileRole }>();
  release.units.forEach((unit, index) => unit.files.forEach((file) => unitOf.set(file.path, { index, role: file.role })));

  const matching = units.filter((unit) => unit.matchesMedium);
  let status: BookRequestUploadPlanStatus;
  let selectedUnitIndex: number | null = null;
  if (units.length === 0) {
    const primaries = release.containers.filter((container) => !isContinuationVolume(container.path));
    status = primaries.length === 1 ? 'archive' : primaries.length > 1 ? 'several_archives' : 'no_book';
  } else if (matching.length === 0) {
    status = 'wrong_medium';
  } else if (matching.length === 1) {
    status = 'ready';
    selectedUnitIndex = matching[0]!.index;
  } else {
    status = 'choose';
    selectedUnitIndex = matching.find((unit) => unit.matchesTitle)?.index ?? null;
  }

  const planned: PlannedUploadFile[] = files.map((file) => {
    const base = {
      path: file.path,
      releasePath: file.releasePath,
      sizeBytes: file.sizeBytes,
      format: formatOf(file.path),
      tooLarge: file.sizeBytes > context.maxFileSizeBytes,
    };
    if (file.sizeBytes <= 0) return { ...base, role: 'skipped', unitIndex: null, skipReason: 'empty' };
    if (folderDepth(file.releasePath) > MAX_FOLDER_DEPTH) return { ...base, role: 'skipped', unitIndex: null, skipReason: 'junk_folder' };

    const owner = unitOf.get(file.releasePath);
    if (owner) {
      // Beside a book the request can take, one it cannot, or one the choice did not land on, is
      // left behind. With nothing it can take, every file stays as it is and the plan says why.
      const sendable = status === 'ready' || status === 'choose';
      const leftOut = sendable && (!units[owner.index]!.matchesMedium || (status === 'ready' && owner.index !== selectedUnitIndex));
      if (leftOut) return { ...base, role: 'skipped', unitIndex: owner.index, skipReason: 'other_book' };
      return { ...base, role: roleOf(owner.role, base.format), unitIndex: owner.index, skipReason: null };
    }
    if (containers.has(file.releasePath)) {
      return status === 'archive' || status === 'several_archives'
        ? { ...base, role: 'archive', unitIndex: null, skipReason: null }
        : { ...base, role: 'skipped', unitIndex: null, skipReason: 'unsupported' };
    }
    return { ...base, role: 'skipped', unitIndex: null, skipReason: skipReasonOf(file.releasePath, ignored.get(file.releasePath)) };
  });

  if ((status === 'ready' || status === 'archive') && uploadSet(planned, status, selectedUnitIndex).some((file) => file.tooLarge)) {
    status = 'file_too_large';
  }

  return {
    plan: {
      status,
      rootName,
      units,
      selectedUnitIndex,
      files: planned.map(publicFile),
      maxFileSizeBytes: context.maxFileSizeBytes,
    },
    files: planned,
  };
}

function publicFile(file: PlannedUploadFile): BookRequestUploadPlanFile {
  return {
    path: file.path,
    sizeBytes: file.sizeBytes,
    format: file.format,
    role: file.role,
    unitIndex: file.unitIndex,
    skipReason: file.skipReason,
    tooLarge: file.tooLarge,
  };
}

/** The files an upload in this state sends: the chosen book, or the archive. */
export function uploadSet<T extends BookRequestUploadPlanFile>(files: T[], status: BookRequestUploadPlanStatus, unitIndex: number | null): T[] {
  return bookRequestUploadSet(files, status, unitIndex);
}

/**
 * One picked path as the attempt stores it. Each segment is cleaned the way an upload session
 * cleans a filename, so the name a session arrives with is the name the manifest expects; a hidden
 * segment keeps its leading dot, which is what marks it to be left out.
 */
export function normalizeUploadPath(raw: string, sanitizeName: (name: string) => string): string {
  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0) throw new BadRequestException('A picked file has no name');
  if (segments.some((segment) => segment === '..')) throw new BadRequestException(`"${raw}" leaves the folder it was picked from`);
  return segments.map((segment) => (segment.startsWith('.') ? cleanHidden(segment) : sanitizeName(segment))).join('/');
}

function cleanHidden(segment: string): string {
  return [...segment]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || FORBIDDEN_SEGMENT_CHARACTERS.test(character) ? '_' : character;
    })
    .join('')
    .slice(0, 255);
}

/** The folder every path sits in, when a whole folder was picked. A lone file has none. */
function commonRoot(paths: string[]): string | null {
  const first = paths[0]?.split('/');
  if (!first || first.length < 2) return null;
  const root = first[0]!;
  return paths.every((path) => path.startsWith(`${root}/`)) ? root : null;
}

function folderDepth(path: string): number {
  return path.split('/').length - 1;
}

function formatOf(path: string): string | null {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

function roleOf(role: FileRole, format: string | null): BookRequestUploadFileRole {
  if (role === 'content') return 'content';
  if (role === 'cover' || (format !== null && IMAGE_FORMATS.has(format))) return 'artwork';
  return 'extra';
}

function skipReasonOf(path: string, reason: ReleaseIgnoredReason | undefined): BookRequestUploadSkipReason {
  if (path.split('/').some((segment) => segment.startsWith('.'))) return 'hidden';
  switch (reason) {
    case 'sample':
      return 'sample';
    case 'padding':
      return 'padding';
    case 'junk_dir':
      return 'junk_folder';
    default:
      return 'unsupported';
  }
}

function planUnit(unit: ReleaseUnit, index: number, context: RequestUploadPlanContext): BookRequestUploadPlanUnit {
  const formats = [...new Set(unit.files.filter((file) => file.role === 'content' && file.format).map((file) => file.format!.toLowerCase()))];
  formats.sort((a, b) => rank(a) - rank(b));
  return {
    index,
    mediaKind: unit.mediaKind,
    title: unit.title,
    contentFileCount: unit.contentFileCount,
    totalFileCount: unit.files.length,
    sizeBytes: unit.sizeBytes ?? 0,
    formats,
    matchesMedium: unit.mediaKind === context.mediaKind,
    matchesTitle: titlesMatch(unit.title, context.title),
  };
}

function rank(format: string): number {
  const index = RELEASE_FORMAT_RANK.indexOf(format);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function titleKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Loose on purpose: it only decides which book is offered first, never which one is filed. */
function titlesMatch(unitTitle: string | null, requestTitle: string): boolean {
  if (!unitTitle) return false;
  const wanted = titleKey(requestTitle);
  if (wanted.length < 3) return false;
  return titleKey(unitTitle).includes(wanted);
}
