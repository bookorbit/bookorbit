import { DEFAULT_FORMAT_PRIORITY } from "./library";

/**
 * Format-priority entry that ranks EPUBs with media overlays apart from plain EPUBs. It is not a
 * file format, so it stays out of `DEFAULT_FORMAT_PRIORITY`, which doubles as the list of book
 * formats. A list without it ranks read-along EPUBs first within the `epub` slot, which is the same
 * as placing it directly before `epub`.
 */
export const READ_ALONG_FORMAT_PRIORITY = "epub:readalong";

/**
 * The key a file ranks, groups and is labelled under: its format, or `epub:readalong` for an EPUB
 * with media overlays. Two EPUBs of one book stay apart only when exactly one of them reads along.
 */
export function bookFormatKey(format: string, readAlong: boolean): string {
  const normalized = format.toLowerCase();
  return normalized === "epub" && readAlong ? READ_ALONG_FORMAT_PRIORITY : normalized;
}

export function isReadAlongFormatKey(key: string): boolean {
  return key === READ_ALONG_FORMAT_PRIORITY;
}

/** The file format a key stands for. */
export function formatOfKey(key: string): string {
  return isReadAlongFormatKey(key) ? "epub" : key;
}

/** The list as the editor shows it: the read-along entry in its implicit slot when absent. */
export function withReadAlongFormatPriority(priority: readonly string[]): string[] {
  if (priority.includes(READ_ALONG_FORMAT_PRIORITY)) return [...priority];
  const epubIndex = priority.indexOf("epub");
  if (epubIndex === -1) return [...priority, READ_ALONG_FORMAT_PRIORITY];
  return [...priority.slice(0, epubIndex), READ_ALONG_FORMAT_PRIORITY, ...priority.slice(epubIndex)];
}

/**
 * The list as it is saved: the read-along entry dropped when it sits in its implicit slot, so
 * libraries that never move it keep the stored list, and the scan-settings hash, they had before.
 */
export function withoutImplicitReadAlongFormatPriority(priority: readonly string[]): string[] {
  const index = priority.indexOf(READ_ALONG_FORMAT_PRIORITY);
  if (index === -1 || priority[index + 1] !== "epub") return [...priority];
  return priority.filter((_, i) => i !== index);
}

/**
 * A library's stored priority completed for ranking: book formats it predates appended in default
 * order, and the read-along entry placed. An empty or missing list means the default order.
 */
export function normalizeFormatPriority(stored: readonly string[] | null | undefined): string[] {
  const base = stored && stored.length > 0 ? stored.map((entry) => entry.toLowerCase()) : [...DEFAULT_FORMAT_PRIORITY];
  const missing = DEFAULT_FORMAT_PRIORITY.filter((format) => !base.includes(format));
  return withReadAlongFormatPriority([...base, ...missing]);
}

/** Position of a key in a normalized priority; unknown keys rank last. */
export function formatKeyRank(key: string, normalizedPriority: readonly string[]): number {
  const index = normalizedPriority.indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
