import { extname, basename } from 'path';
import { DEFAULT_FORMAT_PRIORITY } from '@bookorbit/types';

export const AUDIO_FORMATS = new Set(['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac']);

export function isAudioFormat(format: string): boolean {
  return AUDIO_FORMATS.has(format.toLowerCase());
}

export { DEFAULT_FORMAT_PRIORITY };
const PRIMARY_FORMATS = new Set<string>(DEFAULT_FORMAT_PRIORITY as readonly string[]);

const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const COVER_BASENAMES = new Set(['cover', 'folder', 'thumbnail', 'artwork', 'front']);
const METADATA_EXTENSIONS = new Set(['opf', 'nfo']);

export const FILE_ROLES = ['content', 'cover', 'metadata', 'supplement'] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export interface Classification {
  format: string | null;
  role: FileRole;
}

export function classifyFile(absolutePath: string): Classification {
  const ext = extname(absolutePath).toLowerCase().slice(1);
  const stem = basename(absolutePath, extname(absolutePath)).toLowerCase();

  if (PRIMARY_FORMATS.has(ext)) return { format: ext, role: 'content' };
  if (METADATA_EXTENSIONS.has(ext)) return { format: ext, role: 'metadata' };
  if (COVER_EXTENSIONS.has(ext)) return { format: ext, role: COVER_BASENAMES.has(stem) ? 'cover' : 'supplement' };

  return { format: ext || null, role: 'supplement' };
}

export function isPrimaryFormat(absolutePath: string): boolean {
  return PRIMARY_FORMATS.has(extname(absolutePath).toLowerCase().slice(1));
}
