export const DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE =
  "<{authors:first}|Unknown Author>/<{series}/><{seriesIndex}. ><{title}|{originalFilename}>< ({year})>";
export const DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER =
  "<{authors:first}|Unknown Author>/<{series}/><{seriesIndex}. ><{title}|{originalFilename}>< ({year})>/<{seriesIndex}. ><{title}|{originalFilename}>< ({year})>";
export const DEFAULT_DOWNLOAD_PATTERN = "{originalFilename}";
export const DEFAULT_KOREADER_DEVICE_PATTERN = "<Series/{series}/|Standalone/{authors:first} - ><{seriesIndex:fixed2} - >{title}";

export const EXAMPLE_PATTERN_METADATA: Record<string, string> = {
  title: "Neuromancer",
  subtitle: "20th Anniversary Edition",
  authors: "William Gibson",
  year: "1984",
  series: "Sprawl",
  seriesIndex: "01",
  language: "English",
  publisher: "Ace Books",
  isbn: "9780441569595",
  originalFilename: "neuromancer",
  extension: "epub",
};

export const PATTERN_TOKENS = [
  { token: "title", description: "Book title" },
  { token: "subtitle", description: "Book subtitle" },
  { token: "authors", description: "Author(s), comma-separated" },
  { token: "year", description: "Publication year" },
  { token: "series", description: "Series name" },
  { token: "seriesIndex", description: "Series index (zero-padded)" },
  { token: "publisher", description: "Publisher" },
  { token: "isbn", description: "ISBN-13" },
  { token: "language", description: "Language" },
  { token: "originalFilename", description: "Original filename (without extension)" },
  { token: "extension", description: "File extension (without dot)" },
] as const;

export type PatternToken = (typeof PATTERN_TOKENS)[number]["token"];
export type PathResolverOptions = {
  sanitizeForCrossPlatform?: boolean;
  replacementCharacter?: "_" | "-";
};

export const MAX_PATH_SEGMENT_BYTES = 255;

const MODIFIER_PLACEHOLDER_REGEX = /\{([^}:]+)(?::([^}]+))?}/g;
const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);
const INVALID_SEGMENT_CHARS_REGEX = /[<>:"/\\|?*\u0000-\u001F]/g;

export function applyModifier(value: string, modifier: string, fieldName: string): string {
  if (!value) return value;

  switch (modifier) {
    case "first":
      return value.split(", ")[0].trim();
    case "sort": {
      const first = value.split(", ")[0].trim();
      const lastSpace = first.lastIndexOf(" ");
      return lastSpace > 0 ? `${first.substring(lastSpace + 1)}, ${first.substring(0, lastSpace)}` : first;
    }
    case "initial": {
      let target = value;
      if (fieldName === "authors") {
        const firstAuthor = value.split(", ")[0].trim();
        const lastSpace = firstAuthor.lastIndexOf(" ");
        target = lastSpace > 0 ? firstAuthor.substring(lastSpace + 1) : firstAuthor;
      }
      return target.charAt(0).toUpperCase();
    }
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "fixed2": {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric.toFixed(2) : value;
    }
    default:
      return value;
  }
}

function resolveModifierPlaceholders(block: string, values: Record<string, string>): string {
  return block.replace(MODIFIER_PLACEHOLDER_REGEX, (_, fieldName: string, modifier?: string) => {
    const val = values[fieldName] ?? "";
    return modifier ? applyModifier(val, modifier, fieldName) : val;
  });
}

function checkAllPlaceholdersPresent(block: string, values: Record<string, string>): boolean {
  const matches = [...block.matchAll(MODIFIER_PLACEHOLDER_REGEX)];
  return matches.every((m) => values[m[1]]?.trim());
}

export function replacePlaceholders(pattern: string, values: Record<string, string>): string {
  // Handle optional blocks with else clause: <primary|fallback>
  pattern = pattern.replace(/<([^<>]+)>/g, (_, blockContent: string) => {
    const pipeIndex = blockContent.indexOf("|");
    const primary = pipeIndex >= 0 ? blockContent.substring(0, pipeIndex) : blockContent;
    const fallback = pipeIndex >= 0 ? blockContent.substring(pipeIndex + 1) : null;

    if (checkAllPlaceholdersPresent(primary, values)) {
      return resolveModifierPlaceholders(primary, values);
    }
    return fallback != null ? resolveModifierPlaceholders(fallback, values) : "";
  });

  return resolveModifierPlaceholders(pattern, values).trim();
}

export function validatePattern(pattern: string): boolean {
  const validPatternRegex = /^[\w\s\-{}\[\]/<>().,:'"|]*$/;
  return validPatternRegex.test(pattern);
}

function normalizeResolverOptions(options?: PathResolverOptions): Required<PathResolverOptions> {
  return {
    sanitizeForCrossPlatform: options?.sanitizeForCrossPlatform ?? false,
    replacementCharacter: options?.replacementCharacter === "-" ? "-" : "_",
  };
}

function sanitizePathSegmentValue(value: string, replacementCharacter: "_" | "-"): string {
  let sanitized = value
    .replace(INVALID_SEGMENT_CHARS_REGEX, replacementCharacter)
    .trim()
    .replace(/[. ]+$/g, "");
  if (!sanitized || sanitized === "." || sanitized === "..") {
    sanitized = replacementCharacter;
  }

  const leadingStem = sanitized.split(".")[0]?.toUpperCase() ?? "";
  if (WINDOWS_RESERVED_NAMES.has(leadingStem)) {
    sanitized = `${sanitized}${replacementCharacter}`;
  }

  return sanitized;
}

function sanitizeResolutionValues(values: Record<string, string>, options: Required<PathResolverOptions>): Record<string, string> {
  if (!options.sanitizeForCrossPlatform) return values;

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    sanitized[key] = value.trim() ? sanitizePathSegmentValue(value, options.replacementCharacter) : "";
  }

  return sanitized;
}

function normalizeDotExt(ext: string): string {
  const trimmed = ext.trim();
  if (!trimmed) return "";
  const bare = trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
  if (!bare) return "";
  return `.${bare}`;
}

function ensureTrailingExtension(value: string, dotExt: string): string {
  if (!dotExt) return value;
  return value.toLowerCase().endsWith(dotExt.toLowerCase()) ? value : `${value}${dotExt}`;
}

function ensurePathLastSegmentExtension(path: string, dotExt: string): string {
  if (!dotExt) return path;
  const segments = path.split("/");
  const lastIdx = segments.length - 1;
  const lastSegment = segments[lastIdx] ?? "";
  segments[lastIdx] = ensureTrailingExtension(lastSegment, dotExt);
  return segments.join("/");
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";

  for (const char of value) {
    const charBytes = utf8ByteLength(char);
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }

  return result;
}

function hashSegment(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function truncatePathSegment(segment: string, suffixToPreserve = ""): string {
  if (!segment || utf8ByteLength(segment) <= MAX_PATH_SEGMENT_BYTES) return segment;

  const preservedSuffix =
    suffixToPreserve && segment.toLowerCase().endsWith(suffixToPreserve.toLowerCase()) ? segment.slice(-suffixToPreserve.length) : "";
  const stem = preservedSuffix ? segment.slice(0, -preservedSuffix.length) : segment;
  const truncationSuffix = `~${hashSegment(segment)}`;
  const suffixBytes = utf8ByteLength(truncationSuffix) + utf8ByteLength(preservedSuffix);
  const stemBudget = MAX_PATH_SEGMENT_BYTES - suffixBytes;

  if (stemBudget <= 0) {
    return truncateUtf8(segment, MAX_PATH_SEGMENT_BYTES);
  }

  return `${truncateUtf8(stem, stemBudget)}${truncationSuffix}${preservedSuffix}`;
}

function limitPathSegmentBytes(path: string, dotExt: string): string {
  const segments = path.split("/");
  const lastIdx = segments.length - 1;
  return segments.map((segment, index) => truncatePathSegment(segment, index === lastIdx ? dotExt : "")).join("/");
}

/**
 * Resolves a file naming pattern to a relative path (no leading slash).
 * - Pattern ending with '/' → folder path; original filename is used as the file stem.
 * - Otherwise → the resolved string is the full relative path; extension is appended if missing.
 *
 * Returns null if the pattern resolves to an empty string.
 */
export function resolveUploadPath(pattern: string, values: Record<string, string>, ext: string, options?: PathResolverOptions): string | null {
  const normalizedOptions = normalizeResolverOptions(options);
  const resolvedValues = sanitizeResolutionValues(values, normalizedOptions);
  const resolved = replacePlaceholders(pattern, resolvedValues);
  if (!resolved) return null;

  const dotExt = normalizeDotExt(ext);

  if (resolved.endsWith("/")) {
    const filename = ensureTrailingExtension(resolvedValues["originalFilename"] ?? "upload", dotExt);
    return limitPathSegmentBytes(resolved + filename, dotExt);
  }

  return limitPathSegmentBytes(ensurePathLastSegmentExtension(resolved, dotExt), dotExt);
}

/**
 * Resolves a file naming pattern to a filename (no path separators).
 * - If the resolved pattern contains folder segments, only the last segment is used.
 * - If the resolved pattern ends with '/', originalFilename is used.
 * - Extension is appended when missing.
 *
 * Returns null if the pattern resolves to an empty filename.
 */
export function resolveDownloadFilename(pattern: string, values: Record<string, string>, ext: string, options?: PathResolverOptions): string | null {
  const normalizedOptions = normalizeResolverOptions(options);
  const resolvedValues = sanitizeResolutionValues(values, normalizedOptions);
  const resolved = replacePlaceholders(pattern, resolvedValues);
  if (!resolved) return null;

  const dotExt = normalizeDotExt(ext);
  let stem = resolved.endsWith("/") ? (resolvedValues["originalFilename"] ?? "") : (resolved.split("/").filter(Boolean).pop() ?? "");
  stem = stem.trim();
  if (!stem) return null;

  return truncatePathSegment(ensureTrailingExtension(stem, dotExt), dotExt);
}
