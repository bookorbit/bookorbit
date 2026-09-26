// Title-cleaning utilities for MangaBaka metadata searches.
// Volume markers must appear at the end of the string so legitimate titles
// containing "v" or "t" mid-string are preserved.

// Matches a trailing volume marker with an explicit prefix (T, Vol, v, issue, ch...).
// Allows an optional trailing year (e.g. "Naruto Vol.72 2014") by not requiring
// the marker to be the very last token; the year is stripped separately.
const VOLUME_MARKER_RE = /\s+(?:t(?:ome)?|vol(?:ume)?|v|issue|ch(?:apter)?)\.?\s*\d+(?:\.\d+)?(?:\s+\d{4})?\s*$/i;

// Matches a trailing year (4 digits 1000-2999) that may follow a volume marker.
const TRAILING_YEAR_RE = /\s+[1-2]\d{3}\s*$/;

// Matches a bare trailing number or range (e.g. "Fairy Tail 13", "Naruto 1-5").
// For ranges, the first number is used as the volume.
const BARE_VOLUME_RE = /\b(\d+)(?:-\d+)?\s*$/;

// Manga volumes rarely exceed 150; reject numbers that are likely years.
const MAX_VOLUME_NUMBER = 200;

// Common file extensions to strip before processing.
const FILE_EXT_RE = /\.(?:cbz|cbr|zip|rar|7z|epub|pdf|png|jpe?g)$/i;

// Mid-string volume marker: matches Vol/Volume/Tome/T followed by a number,
// then a separator (chapter marker, dash, paren, bracket, underscore, or end).
// This prevents false positives like "Vol 7 Complex" where "Complex" is part of the title.
// Also matches "Vol12" (no space) and "Vol. 06" followed by chapter markers.
// The lookahead matches: a separator character (-, (, [, _, }, ]), a chapter marker,
// a file extension, or end of string.
// For chapter markers, we match "ch", "chapter", "chp" (with optional trailing word chars
// or a dot), or standalone "c" followed by a digit.
const SEPARATOR_OR_END = /(?=\s*(?:[-([\]_}]|(?:ch(?:apter|p)?)(?:\.?(?=\d|\s))|c(?=\d)|\.(?:cbz|cbr|zip|rar|7z|epub|pdf|png|jpe?g)\s*$|$))/i;

const VOLUME_MIDSTRING_RE = new RegExp(
  '\\b(?:vol(?:ume)?|tome|t)\\.?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?' + SEPARATOR_OR_END.source,
  'i',
);

// Standalone v prefix for mid-string matching (v01, v16-17).
// Must be at a word boundary and followed by a digit (not a letter).
// After underscore-to-space replacement, _v becomes " v" so \bv matches.
const V_MIDSTRING_RE = new RegExp('\\bv\\.?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?' + SEPARATOR_OR_END.source, 'i');

// Multilingual volume patterns for search-anywhere matching.
const MULTILINGUAL_VOLUME_PATTERNS = [
  // Chinese: 第XX卷, 第XX册
  /第\s*(\d+(?:\.\d+)?)\s*[卷册]/,
  // Chinese: 卷XX, 册XX
  /[卷册]\s*(\d+(?:\.\d+)?)/,
  // Japanese: X-Y巻 (range), X巻
  /(\d+(?:\.\d+)?)\s*-\s*\d+(?:\.\d+)?\s*巻/,
  /(\d+(?:\.\d+)?)\s*巻/,
  // Korean: 제X권, X-Y권, X권, 시즌X-Y, 시즌X, X장
  /제\s*(\d+(?:\.\d+)?)\s*권/,
  /(\d+(?:\.\d+)?)\s*-\s*\d+(?:\.\d+)?\s*권/,
  /(\d+(?:\.\d+)?)\s*권/,
  /시즌\s*(\d+(?:\.\d+)?)\s*-\s*\d+/,
  /시즌\s*(\d+(?:\.\d+)?)/,
  /(\d+(?:\.\d+)?)\s*장/,
  // Russian: Том X, Тома X-Y
  /том[а-я]?\s+(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?/i,
  // Thai: เล่ม X, เล่มที่ X
  /เล่ม(?:ที่)?\s+(\d+(?:\.\d+)?)/,
];

// Chapter extraction patterns.
const CHAPTER_PATTERNS = [
  // Ch. 12, Ch 12, Chapter 12, chapter 12, Chp. 1, Chp 1
  /(?:ch(?:apter|p)?)\.?\s*(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?/i,
  // c001, c090-098 (standalone c prefix with digits)
  /\bc(\d{2,4}(?:\.\d+)?)(?:-\d{2,4}(?:\.\d+)?)?/i,
  // #001, #201
  /#(\d+(?:\.\d+)?)/,
  // Chinese/Japanese: 第25话, 第10話, 第13回
  /第\s*(\d+)\s*[话話回]/,
  // Thai: ตอนที่ 3, บทที่ 112
  /(?:ตอนที่|บทที่)\s+(\d+)/,
  // Russian: Глава 3
  /глава\s+(\d+)/i,
  // Korean: 106화, 13회
  /(\d+)\s*[화회]/,
  // Bare 3-4 digit chapter numbers at end of string (e.g. "Bleach 001-003" -> 1)
  // Only match when preceded by a word boundary and the number has leading zeros
  // or is part of a range, to avoid matching volume numbers.
  /(?<=\s)(\d{3,4})(?:-\d{3,4})?(?=\s*$)/,
];

function stripBrackets(title: string): string {
  let prev: string;
  let result = title;
  do {
    prev = result;
    result = result
      .replace(/\s*\[[^\][]*\]/g, '')
      .replace(/\s*\([^()]*\)/g, '')
      .replace(/\s*《[^《》]*》/g, '')
      .replace(/\s*【[^【】]*】/g, '')
      .trim();
  } while (result !== prev);
  return result;
}

// Detects language hints from bracketed metadata in filenames.
// "[Manga FR]" -> "fr", "[Manga EN]" -> "en", "[Manga ES]" -> "es"
// Returns undefined when no language hint is found.
const LANG_HINT_RE = /\[(?:manga|anime|scan)\s+([a-z]{2})\]/i;

export function detectLanguageHint(title: string): string | undefined {
  const match = title.match(LANG_HINT_RE);
  if (!match) return undefined;
  return match[1].toLowerCase();
}

function stripTrailingYear(title: string): string {
  return title.replace(TRAILING_YEAR_RE, '').trim();
}

function stripFileExtension(title: string): string {
  return title.replace(FILE_EXT_RE, '').trim();
}

// Extracts volume number from bracket content like "[Volume 11]" or "(v01)".
function extractVolumeFromBrackets(title: string): number | undefined {
  // Check bracket contents [...]
  const bracketContents = [...title.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
  for (const content of bracketContents) {
    const match = content.match(/vol(?:ume)?\.?\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) return num;
    }
  }
  // Check paren contents (...)
  const parenContents = [...title.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  for (const content of parenContents) {
    const match = content.match(/\bv\.?\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) return num;
    }
  }
  return undefined;
}

const MAX_STRIP_DEPTH = 3;

export function stripVolumeMarker(title: string, depth: number = 0): string {
  if (depth >= MAX_STRIP_DEPTH) {
    return title;
  }

  const noExt = stripFileExtension(title);
  // Strip parens containing volume markers before general bracket stripping
  // (e.g. "(v01)" in "Gokukoku no Brynhildr - c001-008 (v01)")
  const noParenVol = noExt.replace(/\s*\(\s*v\.?\s*\d+(?:\.\d+)?\s*\)/gi, '').trim();
  const noBrackets = stripBrackets(noParenVol);
  const noYear = stripTrailingYear(noBrackets);
  const cleanUnderscores = noYear.replace(/_/g, ' ').trim();

  // Pass 1: Trailing volume marker
  const stripped = cleanUnderscores.replace(VOLUME_MARKER_RE, '').trim();
  if (stripped !== cleanUnderscores) {
    // Recurse to handle remaining mid-string markers (e.g. "Mujaki no Rakuen Vol12 ch76"
    // strips ch76 first, then needs to strip Vol12)
    return stripVolumeMarker(stripped, depth + 1);
  }

  // Pass 2: Mid-string volume marker: truncate everything from the marker onward
  const midMatch = cleanUnderscores.match(VOLUME_MIDSTRING_RE);
  if (midMatch && midMatch.index !== undefined) {
    const before = cleanUnderscores.slice(0, midMatch.index).trim();
    if (before.length > 0) {
      return before.replace(/[\s.]+$/, '').trim();
    }
    // Volume marker at start: extract the part after the volume number
    const after = cleanUnderscores.slice(midMatch.index + midMatch[0].length).trim();
    return after.replace(/^[\s-]+/, '').trim() || cleanUnderscores.trim();
  }

  // Pass 3: Standalone v prefix: \bv\d
  const vMatch = cleanUnderscores.match(V_MIDSTRING_RE);
  if (vMatch && vMatch.index !== undefined) {
    const before = cleanUnderscores.slice(0, vMatch.index).trim();
    if (before.length > 0) {
      return before.replace(/[\s.]+$/, '').trim();
    }
    // v prefix at start: extract the part after the volume number
    const after = cleanUnderscores.slice(vMatch.index + vMatch[0].length).trim();
    return after.replace(/^[\s-]+/, '').trim() || cleanUnderscores.trim();
  }

  // Pass 4: Only strip a bare trailing number if there is a word before it and the
  // number is a plausible volume (not a year > MAX_VOLUME_NUMBER).
  const bareMatch = cleanUnderscores.match(/\s+(\d+)(?:-\d+)?\s*$/);
  if (bareMatch) {
    const before = cleanUnderscores.slice(0, bareMatch.index).trim();
    const num = parseInt(bareMatch[1], 10);
    if (before.length > 0 && /\p{L}/u.test(before) && Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) {
      return before;
    }
  }

  return cleanUnderscores.trim();
}

// Extracts a trailing volume number from a book title.
// "Death Note T09" -> 9, "Death Note Vol. 9" -> 9, "Fairy Tail 13" -> 13
// For ranges like "Naruto 1-5", returns the first number (1).
// Returns undefined when no volume marker is present or the number exceeds
// MAX_VOLUME_NUMBER (likely a year, not a volume).
const VOLUME_NUMBER_RE = /\b(?:t(?:ome)?|vol(?:ume)?|v|issue|ch(?:apter)?)\.?\s*(\d+)(?:\.\d+)?(?:\s+\d{4})?\s*$/i;

export function extractVolumeNumber(title: string): number | undefined {
  const noExt = stripFileExtension(title);

  // Extract from brackets first (e.g. [Volume 11])
  const bracketVol = extractVolumeFromBrackets(noExt);
  if (bracketVol !== undefined) return bracketVol;

  // Strip parens containing volume markers before general bracket stripping
  // (e.g. "(v01)" in "Gokukoku no Brynhildr - c001-008 (v01)")
  const noParenVol = noExt.replace(/\s*\(\s*v\.?\s*\d+(?:\.\d+)?\s*\)/gi, '').trim();
  const noBrackets = stripBrackets(noParenVol);
  const noYear = stripTrailingYear(noBrackets);
  const cleanUnderscores = noYear.replace(/_/g, ' ').trim();

  // Pass 1: Trailing volume marker (existing behavior, keep for backward compat)
  const trailingMatch = cleanUnderscores.match(VOLUME_NUMBER_RE);
  if (trailingMatch) {
    // If the trailing match is a chapter marker (ch, chapter) and there is a
    // volume marker (vol, tome, t, v) before it in the string, skip this match
    // so the mid-string pass can find the volume marker instead.
    const isChapterMarker = /^ch(?:apter)?\.?/i.test(trailingMatch[0].trim());
    const hasVolumeBefore = isChapterMarker && /(?:vol(?:ume)?|tome|t)\.?\s*\d/i.test(cleanUnderscores.slice(0, trailingMatch.index));
    const hasVBefore = isChapterMarker && /\bv\.?\s*\d/i.test(cleanUnderscores.slice(0, trailingMatch.index));
    if (!isChapterMarker || (!hasVolumeBefore && !hasVBefore)) {
      const num = parseInt(trailingMatch[1], 10);
      if (Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) return num;
    }
  }

  // Pass 2: Mid-string volume marker followed by separator or chapter marker
  // This catches "Vol. 0001 Ch. 0001", "v01 - ch. 09", "v11_c90", etc.
  const midMatch = cleanUnderscores.match(VOLUME_MIDSTRING_RE);
  if (midMatch) {
    const num = parseInt(midMatch[1], 10);
    if (Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) return num;
  }

  // Pass 3: Standalone v prefix mid-string
  const vMatch = cleanUnderscores.match(V_MIDSTRING_RE);
  if (vMatch) {
    const num = parseInt(vMatch[1], 10);
    if (Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) return num;
  }

  // Pass 4: Multilingual markers (run before bare trailing number to avoid
  // false positives like "63권#200" where bare trailing number would match "200")
  for (const pattern of MULTILINGUAL_VOLUME_PATTERNS) {
    const match = cleanUnderscores.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) return num;
    }
  }

  // Pass 5: Trailing bare number
  const bareMatch = cleanUnderscores.match(BARE_VOLUME_RE);
  if (bareMatch) {
    const before = cleanUnderscores.slice(0, bareMatch.index).trim();
    if (before.length > 0 && /\p{L}/u.test(before)) {
      const num = parseInt(bareMatch[1], 10);
      if (Number.isFinite(num) && num > 0 && num <= MAX_VOLUME_NUMBER) return num;
    }
  }

  return undefined;
}

// Extracts a chapter number from a filename.
// "Death Note Vol. 4 Ch. 12" -> 12
// "Naruto c090-098" -> 90 (first chapter in range)
// "Bleach_001-003" -> 1
// Returns undefined when no chapter is found.
export function extractChapterNumber(title: string): number | undefined {
  const noExt = stripFileExtension(title);
  const noBrackets = stripBrackets(noExt);
  const clean = noBrackets.replace(/_/g, ' ').trim();

  for (const pattern of CHAPTER_PATTERNS) {
    const match = clean.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num >= 0) return num;
    }
  }

  return undefined;
}
