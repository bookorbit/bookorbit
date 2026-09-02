import { BOOK_REQUEST_MEDIA_KINDS, type BookRequestMediaKind } from "./book-request";
import { languagesAgree } from "./language";

/**
 * Release profiles: the edition an operator wants, expressed once, so a release can be grabbed
 * without a person looking at the list.
 *
 * A profile is an ORDERED list of tiers, best first. The first tier a release matches is its tier,
 * and that tier is a **separate axis from the release score**, never folded into it. Auto-grab
 * takes the highest tier that has any candidate and then the best score within it. Folding tier
 * points into the score was considered and rejected: enough points to make a format preference
 * meaningful is also enough to outrank a genuine title-match difference, which is exactly what the
 * 55-point match weight exists to prevent.
 *
 * A release matching no tier keeps `tier: null`. It stays visible in the picker, sorted last, and
 * a person may still pick it; the automation refuses it and hands the request back.
 */

/** Whether a release is one book file or several. Named because the picker facets on it too. */
export type ReleaseFileLayout = "single" | "multi";

/**
 * How many entries a release may carry and still be **one book file**.
 *
 * The count a search returns is every entry in the torrent: the book, its `.cue`, its cover art,
 * its `.nfo`. So an exact test for one file matches almost nothing real - testing `=== 1` made
 * "single file" match no MyAnonaMouse release at all, including `Shroud.m4b` shipped beside a cue,
 * a jpg and an nfo, which is four entries and one book.
 *
 * Five is where observed packaging tops out (book, cue, artwork, nfo, and one spare). It is a
 * threshold, not a fact: this cannot be answered exactly from a search, because the count of
 * *content* files lives only in the manifest and reading that costs a credentialed fetch per
 * release, which is why inspection is on demand. A five-part audiobook therefore reads as single
 * here, and a single book wrapped in six sidecars reads as multi.
 */
export const SINGLE_FILE_MAX_ENTRIES = 5;

/**
 * Which layout a release has, or null where the source stated no count at all. Shared so the
 * picker's facet and a tier's condition can never disagree about what "single" means.
 */
export function classifyFileLayout(fileCount: number | null): ReleaseFileLayout | null {
  if (fileCount === null) return null;
  return fileCount <= SINGLE_FILE_MAX_ENTRIES ? "single" : "multi";
}

/** One axis a tier constrains. Every field is optional; an omitted field constrains nothing. */
export interface ReleaseTierConditions {
  /** Matches when the release carries ANY of these. Empty or absent matches every format. */
  formats?: string[];
  /** Whether the release is one file or several. Absent matches either. */
  fileLayout?: ReleaseFileLayout;
  /** Audio only, and only meaningful where the source published a bitrate. */
  minBitrateKbps?: number;
  /** Audio only. 1 for mono, 2 for stereo. */
  channels?: number;
  /** Matches when the release states ANY of these languages. */
  languages?: string[];
  /** Matches when the release came from ANY of these configured indexers. */
  indexerIds?: number[];
  minSeeders?: number;
  maxSizeBytes?: number;
  /** Only releases that cost no ratio. */
  freeleechOnly?: boolean;
  /** Excludes releases the source will refuse without a privileged account. */
  excludeVipOnly?: boolean;
}

export interface ReleaseTier {
  /** Stable across reorders, so a stored tier survives being dragged up the list. */
  id: string;
  /** The operator's own words, shown on the release row. Never translated. */
  name: string;
  conditions: ReleaseTierConditions;
}

/** One ordered tier list per medium. Empty means no profile, which disables the tier axis. */
export type ReleaseProfiles = Record<BookRequestMediaKind, ReleaseTier[]>;

export function emptyReleaseProfiles(): ReleaseProfiles {
  return Object.fromEntries(BOOK_REQUEST_MEDIA_KINDS.map((kind) => [kind, []])) as ReleaseProfiles;
}

/**
 * The release facts a tier is matched against. Structurally satisfied by `ReleaseCandidateItem`,
 * so the picker can show a tier without a second round trip and the server can evaluate the same
 * rules against its own candidate shape.
 */
export interface ReleaseTierInput {
  formats: string[];
  /** Null where the source reported no count, which must not be read as one file. */
  fileCount: number | null;
  audio: { bitrateKbps: number | null; channels: number | null } | null;
  language: string | null;
  indexerId: number;
  freeleech: boolean;
  vipOnly: boolean;
  seeders: number | null;
  sizeBytes: number | null;
}

/**
 * Whether one release satisfies every condition a tier states.
 *
 * Where the line falls on **unstated** facts depends on whether the source could reasonably have
 * published one, and the two cases are genuinely different:
 *
 * - **Bitrate and channels come from MediaInfo, which is optional per torrent and usually absent.**
 *   MyAnonaMouse returned `{}` for every release of three separate books, so a bitrate floor that
 *   excluded unmeasured releases excluded everything and made a profile unusable on that tracker.
 *   These conditions therefore reject only a value that was stated and fell short. A floor reads as
 *   "nothing measured below this", not "nothing unmeasured".
 * - **File count and size are properties of the torrent itself**, published wherever the source
 *   publishes anything, so silence there is a genuinely unknown release rather than an unmeasured
 *   one, and it does not satisfy a condition about it.
 *
 * Seeders sit with the first group for a different reason: a source with no swarm at all reports
 * null, and holding that against it would bar every direct download from every tier wanting seeds.
 */
export function releaseMatchesTier(release: ReleaseTierInput, conditions: ReleaseTierConditions): boolean {
  const { formats, fileLayout, minBitrateKbps, channels, languages, indexerIds, minSeeders, maxSizeBytes } = conditions;

  if (formats && formats.length > 0) {
    const wanted = formats.map((format) => format.toLowerCase());
    if (!release.formats.some((format) => wanted.includes(format.toLowerCase()))) return false;
  }

  if (fileLayout && classifyFileLayout(release.fileCount) !== fileLayout) return false;

  // Stated and short fails; unstated passes. See the note above: MediaInfo is optional per torrent.
  if (minBitrateKbps !== undefined && release.audio?.bitrateKbps != null && release.audio.bitrateKbps < minBitrateKbps) {
    return false;
  }

  if (channels !== undefined && release.audio?.channels != null && release.audio.channels !== channels) return false;

  if (languages && languages.length > 0) {
    if (!release.language) return false;
    // Compared by subtag rather than as strings: a tier stores the two-letter code the form
    // offers, while a source states whatever it states. MyAnonaMouse reports "ENG", which no
    // amount of lowercasing makes equal to "en", so a raw comparison put every one of its
    // releases outside every tier that named a language.
    const stated = release.language;
    if (!languages.some((language) => languagesAgree(language, stated))) return false;
  }

  if (indexerIds && indexerIds.length > 0 && !indexerIds.includes(release.indexerId)) return false;

  // Seeders are the one exception to "unstated never matches": a source with no swarm at all
  // reports null, and holding that against a direct download would exclude every such source from
  // every tier that asks for a healthy swarm.
  if (minSeeders !== undefined && release.seeders !== null && release.seeders < minSeeders) return false;

  if (maxSizeBytes !== undefined) {
    if (release.sizeBytes === null) return false;
    if (release.sizeBytes > maxSizeBytes) return false;
  }

  if (conditions.freeleechOnly === true && !release.freeleech) return false;
  if (conditions.excludeVipOnly === true && release.vipOnly) return false;

  return true;
}

/**
 * The index of the first tier this release matches, or null for none.
 *
 * An empty tier list returns null for everything, which is what makes adopting this feature safe:
 * `releaseProfileIsActive` is false, the tier axis disengages, and auto-grab keeps behaving exactly
 * as it did before any profile existed.
 */
export function matchReleaseTier(release: ReleaseTierInput, tiers: readonly ReleaseTier[]): number | null {
  const index = tiers.findIndex((tier) => releaseMatchesTier(release, tier.conditions));
  return index === -1 ? null : index;
}

/** Whether a medium has a profile at all. False means score alone decides, as it always did. */
export function releaseProfileIsActive(tiers: readonly ReleaseTier[] | undefined): boolean {
  return (tiers?.length ?? 0) > 0;
}

/**
 * Orders two releases the way the picker and the automation both must: by tier first, then by
 * whatever the caller was already comparing. Untiered sorts after every tier.
 *
 * Shared so the list an approver reads and the list the automation walks cannot disagree about
 * which release is best, which is the same reason `findGrabRefusal` is shared.
 */
export function compareByTier(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Bounds on a stored profile, enforced at the DTO and echoed in the settings form. */
export const MAX_RELEASE_TIERS = 12;
export const MAX_RELEASE_TIER_NAME_LENGTH = 60;
