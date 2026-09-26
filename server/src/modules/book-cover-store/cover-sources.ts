import { isAudioFormat, type CoverMedium } from '@bookorbit/types';
import { basename } from 'path';

import { naturalCompare } from '../../common/utils/natural-sort.utils';
import { selectPrimaryFile } from '../../common/utils/primary-file-selection.utils';

export const FOLDER_IMAGE_FORMATS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

type CoverSourceCandidate = {
  id: number;
  absolutePath: string;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  mediaOverlayAvailable?: boolean | null;
};

function isContent(role: string): boolean {
  return role === 'content' || role === 'primary';
}

/**
 * The file whose embedded art fills each slot: the first ebook in the library's format priority,
 * and the first audio track in natural name order. An EPUB's read-along audio is never an audio
 * source, because its art is the ebook cover.
 */
export function selectEmbeddedCoverSources<T extends CoverSourceCandidate>(
  files: readonly T[],
  formatPriority: readonly string[],
): Record<CoverMedium, T | null> {
  const content = files.filter((file) => isContent(file.role) && file.format);
  const ebooks = content.filter((file) => !isAudioFormat(file.format!.toLowerCase()));
  const audio = content
    .filter((file) => isAudioFormat(file.format!.toLowerCase()))
    .sort((a, b) => naturalCompare(basename(a.absolutePath), basename(b.absolutePath)));
  return {
    ebook: selectPrimaryFile(ebooks, formatPriority, { allowZeroByteFallback: true }),
    audio: audio[0] ?? null,
  };
}

export function hasAudioFiles(files: readonly Pick<CoverSourceCandidate, 'format' | 'role'>[]): boolean {
  return files.some((file) => isContent(file.role) && file.format !== null && isAudioFormat(file.format.toLowerCase()));
}

export function selectFolderImages<T extends CoverSourceCandidate>(files: readonly T[]): T[] {
  return files
    .filter((file) => file.role === 'cover' && file.format !== null && FOLDER_IMAGE_FORMATS.has(file.format.toLowerCase()))
    .sort((a, b) => naturalCompare(basename(a.absolutePath), basename(b.absolutePath)));
}
