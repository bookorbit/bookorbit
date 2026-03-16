import { extname, basename } from 'path';

export const DEFAULT_FORMAT_PRIORITY = ['epub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2'];
const PRIMARY_FORMATS = new Set(DEFAULT_FORMAT_PRIORITY);

const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const COVER_BASENAMES = new Set(['cover', 'folder', 'thumbnail', 'artwork', 'front']);
const METADATA_EXTENSIONS = new Set(['opf', 'nfo']);

export type FileRole = 'primary' | 'cover' | 'metadata' | 'supplementary';

export interface Classification {
  format: string | null;
  role: FileRole;
}

export function classifyFile(absolutePath: string): Classification {
  const ext = extname(absolutePath).toLowerCase().slice(1);
  const stem = basename(absolutePath, extname(absolutePath)).toLowerCase();

  if (PRIMARY_FORMATS.has(ext)) return { format: ext, role: 'primary' };
  if (METADATA_EXTENSIONS.has(ext)) return { format: ext, role: 'metadata' };
  if (COVER_EXTENSIONS.has(ext)) return { format: ext, role: COVER_BASENAMES.has(stem) ? 'cover' : 'supplementary' };

  return { format: ext || null, role: 'supplementary' };
}

export function isPrimaryFormat(absolutePath: string): boolean {
  return PRIMARY_FORMATS.has(extname(absolutePath).toLowerCase().slice(1));
}
