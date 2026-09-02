import {
  AUDIO_FORMAT_LIST,
  bookRequestIsbn10To13,
  COMIC_FORMAT_LIST,
  EBOOK_FORMAT_LIST,
  ISO_639_2_TO_1,
  isAudioFormat,
  isComicFormat,
  isValidBookRequestIsbn10,
  languagesAgree,
  matchReleaseTier,
} from '@bookorbit/types';
import type { BookRequestMediaKind, ReleaseCandidateItem, ReleaseScoreReason, ReleaseTier } from '@bookorbit/types';

import { normalizeIsbn, normalizeMetadataIsbn } from '../../../common/text-match/isbn-normalize';
import { TITLE_MATCH_SCORES, scoreTitleMatch } from '../../../common/text-match/title-match';
import type { ReleaseCandidate } from './indexer-adapter';

/**
 * Weights, and the reason each one is what it is. They sum to 100 at their maximum, so a score is
 * readable as a percentage without a normalisation pass that would hide the breakdown. Each reason
 * is rounded on its own, so the weights have to be integers for that sum to land exactly.
 *
 * Freeleech is five of those hundred, so an ordinary release caps at 95: reaching 100 needs a
 * perfect match, the preferred format, a plausible size, a saturated swarm and freeleech together.
 */
const WEIGHTS = {
  /**
   * Does this release describe the requested work at all. Everything else is a tie-breaker.
   *
   * Carries the six points that belonged to per-source priority until that setting was removed.
   * They went here rather than being spread across the tie-breakers because only a good match
   * gains from it: a wrong-book release scores about 0.9 more, a right-book one a full 6, so the
   * gap between them widens rather than narrows.
   */
  match: 61,
  preferredFormat: 12,
  acceptableFormat: 6,
  unknownFormat: 2,
  expectedSize: 10,
  /** A 40 MB "audiobook" is a sample or the wrong medium, and no seeder count redeems it. */
  suspiciousSize: -25,
  seeders: 12,
  freeleech: 5,
  /**
   * A release with this many files is more likely a pack of several books than one book in several
   * formats, and a pack costs an approver a choice after the download - which is exactly the human
   * step unattended grabbing exists to avoid. Small, because being wrong is now a prompt rather
   * than a broken import: the dock holds multi-file units, so ordinary packaging imports whole.
   */
  likelySeveralBooks: -5,
} as const;

const TITLE_WEIGHT = 0.7;
const AUTHOR_WEIGHT = 0.3;

/** Seeders past this add nothing: 200 against 400 is noise, 1 against 20 is not. */
const SEEDER_SATURATION = 60;

/**
 * Three formats plus a cover and an `.opf` is five files and an entirely ordinary single book, so
 * the threshold sits well above that. Past a dozen, a book release is usually a pack.
 */
const SEVERAL_BOOKS_SUSPICION_THRESHOLD = 12;

const MEGABYTE = 1024 * 1024;

/**
 * Plausible sizes per medium. Wide on purpose: an illustrated ebook and a bare text one differ by
 * two orders of magnitude, and the point is to catch a sample or a mislabelled medium, not to
 * express a preference.
 */
const SIZE_RANGES: Record<BookRequestMediaKind, { min: number; max: number }> = {
  ebook: { min: 20 * 1024, max: 400 * MEGABYTE },
  audiobook: { min: 20 * MEGABYTE, max: 8 * 1024 * MEGABYTE },
  comic: { min: 1 * MEGABYTE, max: 4 * 1024 * MEGABYTE },
};

/** Whether a format is a usable one for the requested medium. */
const FORMATS_BY_MEDIA_KIND: Record<BookRequestMediaKind, (format: string) => boolean> = {
  ebook: (format) => (EBOOK_FORMAT_LIST as readonly string[]).includes(format),
  audiobook: (format) => isAudioFormat(format),
  comic: (format) => isComicFormat(format) || format === 'pdf',
};

/**
 * Formats a scene name spells out, so a release with no format field still classifies. Derived
 * from the three shared lists rather than restated: written out by hand it had already lost `cbx`,
 * so a comic release naming that format read as having no format at all.
 */
const FORMAT_TOKENS: readonly string[] = [...EBOOK_FORMAT_LIST, ...AUDIO_FORMAT_LIST, ...COMIC_FORMAT_LIST];

/** The work a release is scored against: the request snapshot, never the library. */
export interface ScoringRequest {
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  isbns: string[];
  mediaKind: BookRequestMediaKind;
  preferredFormats: string[];
  language: string | null;
  /**
   * The profile for this medium, best tier first. Empty means no profile is configured, and every
   * release comes back untiered, which is what keeps the score the only axis it ever was.
   */
  tiers: readonly ReleaseTier[];
}

/**
 * Hard filters, applied before scoring. A release that fails one of these is not a worse choice,
 * it is not a choice: no weighting should be able to float it back up the list.
 */
export function rejectRelease(candidate: ReleaseCandidate, request: ScoringRequest): string | null {
  // Only where the indexer actually stated a count. Some report no swarm data at all, and
  // reading that as zero would reject everything they return.
  if (candidate.seeders !== null && candidate.seeders <= 0) return 'no seeders';

  // A release may state several, as MyAnonaMouse does with "m4a mp3". One usable format is enough.
  const formats = resolveFormats(candidate);
  if (formats.length > 0 && !formats.some((format) => FORMATS_BY_MEDIA_KIND[request.mediaKind](format))) {
    return `${formats.join('/')} is not a ${request.mediaKind} format`;
  }

  const language = resolveLanguage(candidate);
  if (request.language && language && !languagesAgree(request.language, language)) {
    return `in ${language}, not ${request.language}`;
  }

  // No file-count filter. A release carrying several book files is ordinary - three formats of one
  // title, an audiobook in parts - and the dock imports it whole. Where it really is several
  // books, that is a choice an approver makes after the download, not a reason to hide the release.
  return null;
}

export interface ScoredRelease {
  candidate: ReleaseCandidate;
  score: number;
  reasons: ReleaseScoreReason[];
}

export function scoreRelease(candidate: ReleaseCandidate, request: ScoringRequest): ScoredRelease {
  const reasons: ReleaseScoreReason[] = [];

  reasons.push(matchReason(candidate, request));
  reasons.push(formatReason(resolveFormats(candidate), request));

  const sizeReason = sizeReasonFor(candidate, request);
  if (sizeReason) reasons.push(sizeReason);

  if (candidate.seeders !== null) {
    reasons.push({ code: 'seeders', points: round(seederScore(candidate.seeders)), detail: String(candidate.seeders) });
  }

  if (candidate.freeleech) reasons.push({ code: 'freeleech', points: WEIGHTS.freeleech });
  if (candidate.fileCount !== undefined && candidate.fileCount > SEVERAL_BOOKS_SUSPICION_THRESHOLD) {
    reasons.push({ code: 'likelySeveralBooks', points: WEIGHTS.likelySeveralBooks, detail: String(candidate.fileCount) });
  }

  const total = reasons.reduce((sum, reason) => sum + reason.points, 0);
  return { candidate, score: Math.max(0, Math.min(100, round(total))), reasons };
}

export function toReleaseItem(scored: ScoredRelease, indexerName: string, request: ScoringRequest): ReleaseCandidateItem {
  const { candidate } = scored;
  const formats = orderByPreference(resolveFormats(candidate), request.preferredFormats);
  const fileCount = candidate.primaryFileCount ?? candidate.fileCount ?? null;
  const base = {
    indexerId: candidate.indexerId,
    indexerName,
    guid: candidate.guid,
    title: candidate.title,
    sizeBytes: candidate.sizeBytes,
    seeders: candidate.seeders,
    leechers: candidate.leechers,
    format: formats[0] ?? null,
    formats,
    language: resolveLanguage(candidate),
    fileCount,
    freeleech: candidate.freeleech ?? false,
    vipOnly: candidate.vipOnly ?? false,
    alreadyGrabbed: candidate.alreadyGrabbed ?? false,
    publishedAt: candidate.publishedAt ?? null,
    audio: candidate.audio ?? null,
  };

  // Matched on the shape the picker will show rather than on the raw candidate, so the tier an
  // approver reads on a row is the one the automation used to choose it.
  const tier = matchReleaseTier(base, request.tiers);
  return {
    ...base,
    score: scored.score,
    tier,
    tierName: tier === null ? null : (request.tiers[tier]?.name ?? null),
    reasons: scored.reasons,
  };
}

/**
 * A matching ISBN is decisive, but only for a release that also looks like the requested work at
 * all. It is decisive because nothing puts an ISBN in a release name by accident; the qualifier is
 * there because a catalogue puts one in an identifier column on purpose, and a catalogue can be
 * wrong. Library Genesis prints every ISBN it holds against a row, so one recorded against the
 * wrong book used to score a full match and lead the picker ahead of the right one, with no other
 * signal able to outweigh it.
 *
 * Title and author agreement is the qualifier because `scoreTitleMatch` already answers exactly
 * the question being asked: it returns zero for two unrelated titles rather than a small number,
 * so this only rejects a release that describes some other book. Anything that agrees even loosely
 * still takes the full points.
 *
 * `scoreTitleMatch` is deliberately generous about a candidate that extends the query, which is
 * right here (a release name carries the author, the year and the format) and is why a sequel can
 * still rank well. Import verification, which compares symmetrically, is the gate that catches it.
 */
function matchReason(candidate: ReleaseCandidate, request: ScoringRequest): ReleaseScoreReason {
  // The bare work title where the indexer published one, since the release name carries the
  // author, the year and the format flags and only dilutes the comparison.
  const titleText = candidate.bookTitle ?? candidate.title;
  const titleScore = scoreTitleMatch(request.title, titleText) / TITLE_MATCH_SCORES.exact;
  const authorText = candidate.author ?? candidate.title;
  const authors = request.authors.filter(Boolean);
  const authorScore =
    authors.length > 0 ? Math.max(...authors.map((author) => scoreTitleMatch(author, authorText) / TITLE_MATCH_SCORES.exact)) : null;

  const requestedIsbns = [...request.isbns, normalizeMetadataIsbn(request.isbn13), normalizeMetadataIsbn(request.isbn10)].filter(Boolean);
  if (requestedIsbns.length > 0 && (titleScore > 0 || (authorScore ?? 0) > 0)) {
    // The stated field first, then the release name. Both go through `extractIsbns`, which is what
    // makes the stated one safe to read: MyAnonaMouse puts `ASIN:B08G9PRS1K` in the same field, and
    // an ASIN carries no ten- or thirteen-digit run for the pattern to find.
    const releaseIsbns = [...extractIsbns(candidate.isbn ?? ''), ...extractIsbns(candidate.title)];
    if (releaseIsbns.some((isbn) => requestedIsbns.includes(isbn))) {
      return { code: 'isbnMatch', points: WEIGHTS.match };
    }
  }

  const combined = authorScore === null ? titleScore : titleScore * TITLE_WEIGHT + authorScore * AUTHOR_WEIGHT;
  return {
    code: authorScore !== null && authorScore > 0 && titleScore > 0 ? 'authorMatch' : 'titleMatch',
    points: round(combined * WEIGHTS.match),
  };
}

function formatReason(formats: string[], request: ScoringRequest): ReleaseScoreReason {
  if (formats.length === 0) return { code: 'unknownFormat', points: WEIGHTS.unknownFormat };

  const preferred = request.preferredFormats.map((value) => value.toLowerCase());
  // A release carrying both a preferred format and an acceptable one is a preferred release.
  const match = formats.find((format) => preferred.includes(format));
  if (match) return { code: 'preferredFormat', points: WEIGHTS.preferredFormat, detail: match };
  return { code: 'knownFormat', points: WEIGHTS.acceptableFormat, detail: formats[0] };
}

function sizeReasonFor(candidate: ReleaseCandidate, request: ScoringRequest): ReleaseScoreReason | null {
  if (candidate.sizeBytes === null || candidate.sizeBytes <= 0) return null;

  const range = SIZE_RANGES[request.mediaKind];
  const withinRange = candidate.sizeBytes >= range.min && candidate.sizeBytes <= range.max;
  return withinRange
    ? { code: 'expectedSize', points: WEIGHTS.expectedSize }
    : { code: 'suspiciousSize', points: WEIGHTS.suspiciousSize, detail: formatBytes(candidate.sizeBytes) };
}

/** Log-scaled: the gap between 1 and 20 seeders matters, the gap between 200 and 400 does not. */
function seederScore(seeders: number): number {
  if (seeders <= 0) return 0;
  return WEIGHTS.seeders * Math.min(1, Math.log10(seeders + 1) / Math.log10(SEEDER_SATURATION + 1));
}

/**
 * The first format the indexer stated, in its own order. What the grab records, and deliberately
 * not what the picker leads with: see `orderByPreference` for why those differ.
 */
export function resolveFormat(candidate: ReleaseCandidate): string | null {
  return resolveFormats(candidate)[0] ?? null;
}

/**
 * Preferred formats first, in the order the request prefers them, with everything else keeping
 * the indexer's order behind them.
 *
 * The indexer's own order is not a ranking. MyAnonaMouse publishes `filetypes` alphabetically, so
 * a release holding an epub, a mobi and an azw3 led with "azw3" and was labelled and faceted as
 * an AZW3 release, which then hid it from a filter on the very format the approver asked for.
 */
function orderByPreference(formats: string[], preferredFormats: string[]): string[] {
  const preferred = preferredFormats.map((value) => value.toLowerCase());
  const rank = (format: string): number => {
    const index = preferred.indexOf(format);
    return index === -1 ? preferred.length : index;
  };
  // Stable, so formats of equal rank keep the order the indexer stated them in.
  return [...formats].sort((a, b) => rank(a) - rank(b));
}

/**
 * Every format the release claims. The stated field wins where it names any known format, since a
 * tracker that lists file types is more reliable than a scene name; some list several at once.
 */
function resolveFormats(candidate: ReleaseCandidate): string[] {
  const stated = tokenize(candidate.format?.replace(/^\./, '') ?? '');
  if (stated.length > 0) return stated;
  return tokenize(candidate.title);
}

/** Source order, so the format a release names first is the one shown and recorded. */
function tokenize(text: string): string[] {
  const formats: string[] = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (FORMAT_TOKENS.includes(token) && !formats.includes(token)) formats.push(token);
  }
  return formats;
}

/**
 * Codes recognised inside a release title's bracketed flags. Deliberately a strict allowlist of
 * three-letter codes rather than anything `normalizeLanguage` would accept: it truncates an
 * unknown token to two letters, which would read "[VIP]" as Vietnamese and "[HQ]" as nothing at
 * all. A token we do not recognise must leave the language unstated, because the filter then
 * skips rather than rejecting a release for a language it invented.
 *
 * `lit` is excluded despite being Lithuanian: it is also the Microsoft Reader format, and
 * "[EPUB / LIT]" is far more common on a book tracker than a Lithuanian release. It used to be
 * excluded by being in `FORMAT_TOKENS`; BookOrbit does not import Microsoft Reader files, so it is
 * no longer a format we recognise, and the exclusion has to be stated outright or the same title
 * starts reading as Lithuanian.
 */
const NON_LANGUAGE_TITLE_TOKENS: ReadonlySet<string> = new Set(['lit']);

const TITLE_LANGUAGE_TOKENS: ReadonlySet<string> = new Set(
  [
    ...Object.keys(ISO_639_2_TO_1),
    // Codes that truncate to the right two letters on their own, so they never needed a mapping.
    'eng',
    'fre',
    'fra',
    'afr',
    'bos',
    'epo',
    'gle',
    'glg',
    'lat',
    'ltz',
    'mlt',
    'nno',
    'nob',
    'swa',
    'tam',
    'tel',
    'urd',
  ].filter((code) => !FORMAT_TOKENS.includes(code) && !NON_LANGUAGE_TITLE_TOKENS.has(code)),
);

/**
 * What language the release claims. The stated field wins; otherwise the title's bracketed flags
 * are read, because a torznab proxy publishes the language there and not as an attribute at all.
 * Measured against Prowlarr, which titles a release "... by Andy Weir [DUT / M4B]": without this
 * fallback `candidate.language` is undefined for every release it returns, and the hard filter in
 * `rejectRelease` silently stops running rather than failing.
 *
 * Only bracketed segments are considered. A bare three-letter word in a title is far more likely
 * to be part of the title.
 */
export function resolveLanguage(candidate: ReleaseCandidate): string | null {
  if (candidate.language) return candidate.language;

  for (const bracketed of candidate.title.matchAll(/\[([^\]]*)\]/g)) {
    for (const part of bracketed[1].split('/')) {
      const token = part.trim();
      if (TITLE_LANGUAGE_TOKENS.has(token.toLowerCase())) return token;
    }
  }
  return null;
}

/**
 * Every ISBN a release names, in both spellings where a printed one has two.
 *
 * A request holds the canonical ISBN-13 - `canonicalizeBookRequestIsbn` converts a 10 on the way
 * in - while catalogues that predate the 13 print the 10 the book was published under. Without the
 * conversion the two never compare equal, so the decisive sixty-one-point `isbnMatch` was missed
 * on exactly the sources most likely to state an ISBN at all. Checksum-gated: an unvalidated
 * ten-digit run is as likely to be an ASIN or a catalogue number, and converting one would
 * manufacture a 13 that matches a different book.
 */
function extractIsbns(text: string): string[] {
  const matches = text.match(/\b(?:97[89][- ]?)?(?:\d[- ]?){9}[\dxX]\b/g) ?? [];
  const found = new Set<string>();

  for (const match of matches) {
    const isbn = normalizeIsbn(match);
    if (isbn.length !== 10 && isbn.length !== 13) continue;
    found.add(isbn);
    if (isbn.length === 10 && isValidBookRequestIsbn10(isbn)) found.add(bookRequestIsbn10To13(isbn));
  }

  return [...found];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MEGABYTE) return `${(bytes / (1024 * MEGABYTE)).toFixed(1)} GB`;
  if (bytes >= MEGABYTE) return `${Math.round(bytes / MEGABYTE)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function round(value: number): number {
  return Math.round(value);
}
