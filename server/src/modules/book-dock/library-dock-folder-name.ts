import { isIgnoredDockEntryName } from './book-dock-ignored-entries';

/** UTF-8 bytes, so the name fits every filesystem and SMB share the dock is likely to sit on. */
export const DOCK_FOLDER_NAME_MAX_BYTES = 100;

const FORBIDDEN_CHARACTERS = new Set('/\\:*?"<>|');
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A folder name for a library's dock, derived from the library name. Safe on Windows, macOS and
 * Linux shares, never one the dock would skip as system clutter, and unique case-insensitively
 * against `taken`. Falls back to `library-<id>` when nothing usable is left.
 */
export function sanitizeDockFolderName(name: string, libraryId: number, taken: Iterable<string> = []): string {
  const base = cleanDockFolderName(name) || `library-${libraryId}`;
  return uniqueDockFolderName(base, taken);
}

/**
 * The name with everything a dock folder cannot carry removed, or `''` when nothing is left. A
 * name that comes back unchanged (after NFC) is one a manager may type as is.
 */
export function cleanDockFolderName(name: string): string {
  let cleaned = trimEdges(stripForbidden(name.normalize('NFC').replace(/\s+/g, ' ')).replace(/ {2,}/g, ' '));
  // Windows reserves these before any extension too, so `CON.old` becomes `CON_.old`.
  const dot = cleaned.indexOf('.');
  const stem = dot === -1 ? cleaned : cleaned.slice(0, dot);
  if (WINDOWS_RESERVED.test(stem.trim())) cleaned = `${stem.trim()}_${dot === -1 ? '' : cleaned.slice(dot)}`;
  cleaned = trimEdges(truncateUtf8(cleaned, DOCK_FOLDER_NAME_MAX_BYTES));
  if (!cleaned || isIgnoredDockEntryName(cleaned)) return '';
  return cleaned;
}

/** `base`, or `base (2)`, `base (3)` and so on, whichever is free case-insensitively. */
export function uniqueDockFolderName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.normalize('NFC').toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const stem = trimEdges(truncateUtf8(base, DOCK_FOLDER_NAME_MAX_BYTES - Buffer.byteLength(suffix)));
    const candidate = `${stem}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Drops path separators, characters Windows refuses, and C0 and C1 control characters. */
function stripForbidden(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || FORBIDDEN_CHARACTERS.has(char)) continue;
    out += char;
  }
  return out;
}

/** Leading dots would hide the folder; trailing dots and spaces are dropped by Windows and SMB. */
function trimEdges(value: string): string {
  return value.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
}

/** Cuts at a whole code point, so an emoji or accented letter is never split. */
function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let out = '';
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}
