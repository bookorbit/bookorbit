import type { BookRequestMediaKind } from "./book-request";
import type { BookRequestDownloadSource } from "./download-client";
import type { NetworkProfile } from "./network-profile";
import { REQUEST_CREDENTIAL_ERROR_CODES } from "./request-credential";

/**
 * Adapter *types* live in code; configured *instances* are database rows. Nothing here is
 * tracker-specific beyond the type name: BookOrbit ships adapter code, never a tracker, never a
 * credential, and no indexer is preconfigured or enabled by default.
 *
 * Only the generic protocol is built in. Every named source, open library or otherwise, is a
 * plugin loaded from disk and maintained outside this repository.
 */
export const INDEXER_ADAPTER_TYPES = ["torznab"] as const;
export type IndexerAdapterType = (typeof INDEXER_ADAPTER_TYPES)[number];

/**
 * A built-in type name, or the slug an externally loaded adapter chose for itself. Anywhere a
 * value arrives from the database or the wire it is this, not the closed union: a row can name an
 * adapter this build has never heard of, and pretending otherwise is how that row goes missing.
 */
export type IndexerAdapterTypeName = IndexerAdapterType | (string & {});

/**
 * Hues an operator can assign to a source, so a release row says where it came from before the
 * name is read. Stored as a slug rather than a colour: each one resolves to a token tuned per
 * theme, which a hex value chosen by eye in one theme cannot be.
 *
 * Each slug resolves independently from the protocol colors, so the source remains identifiable
 * even when a release also carries a torrent or direct-download badge.
 */
export const INDEXER_COLORS = ["blue", "indigo", "purple", "pink", "red", "orange", "yellow", "lime", "green", "teal"] as const;
export type IndexerColor = (typeof INDEXER_COLORS)[number];

/** Picks an unused source color until every palette entry has been assigned at least once. */
export function pickUnusedIndexerColor(usedColors: Iterable<IndexerColor | null | undefined>): IndexerColor {
  const used = new Set(usedColors);
  const unused = INDEXER_COLORS.filter((color) => !used.has(color));
  const choices = unused.length > 0 ? unused : INDEXER_COLORS;
  return choices[Math.floor(Math.random() * choices.length)] ?? INDEXER_COLORS[0];
}

/** Which of the indexer's own categories to search for each medium a request can ask for. */
export type IndexerCategoryMap = Record<BookRequestMediaKind, number[]>;

/**
 * Starting points, not constraints. Torznab follows the Newznab category numbering (7020 ebooks,
 * 7030 comics, 3030 audiobooks). A source with no categories at all declares an empty map, and
 * `INDEXER_USES_CATEGORIES` hides the editor rather than showing boxes that do nothing.
 */
export const DEFAULT_INDEXER_CATEGORIES: Record<IndexerAdapterType, IndexerCategoryMap> = {
  torznab: { ebook: [7020], audiobook: [3030], comic: [7030] },
};

/** What the credential field holds. Null where the source needs none, as an open library does. */
export const INDEXER_CREDENTIAL_KINDS: Record<IndexerAdapterType, "apiKey" | "sessionId" | null> = {
  torznab: "apiKey",
};

/** Whether the adapter searches by numeric category at all, which decides if the editor shows. */
export const INDEXER_USES_CATEGORIES: Record<IndexerAdapterType, boolean> = {
  torznab: true,
};

/**
 * Whether a grab from this source joins a swarm. Seed goals are handed to the download client at
 * add time, so for a source that serves the file itself they are not a default to fall back on,
 * they are meaningless, and the form must not offer them.
 */
export const INDEXER_SEEDS_BACK: Record<IndexerAdapterType, boolean> = {
  torznab: true,
};

/**
 * Which media a source can actually answer for. A source that does not serve a medium is reported
 * as such in the picker rather than contributing an empty result that reads as "not available".
 */
export const INDEXER_MEDIA_KINDS: Record<IndexerAdapterType, readonly BookRequestMediaKind[]> = {
  torznab: ["ebook", "audiobook", "comic"],
};

/**
 * Prefilled into the form where a source has one canonical address. Still editable, for mirrors.
 * Empty while torznab is the only built-in: its address is the operator's own proxy, and a plugin
 * carries its own `defaultBaseUrl` rather than being listed here.
 */
export const INDEXER_DEFAULT_BASE_URLS: Partial<Record<IndexerAdapterType, string>> = {};

/**
 * Adapter-specific knobs. An open record rather than a fixed shape, because an adapter loaded at
 * runtime declares its own fields and no compile-time type could know them. What may be stored is
 * decided per adapter by its `settingsFields`, validated in the service rather than by the pipe.
 */
export type IndexerSettings = Record<string, unknown>;

/**
 * One configurable field an adapter wants on the settings form beyond the shared ones. Built-in
 * adapters declare these too, so the form has a single way to render both.
 */
export interface IndexerSettingsField {
  key: string;
  type: "boolean" | "string" | "number";
  /** For a plugin this is untranslated English; a built-in prefers its own message key. */
  label: string;
  hint?: string;
  default?: boolean | string | number;
  /**
   * A `string` field that holds a comma-separated list, so the form can edit it as chips rather
   * than as one long line the operator has to punctuate by hand. Opt-in: it cannot be inferred
   * from the value, because plenty of single values legitimately contain a comma.
   */
  format?: "list";
  /** When present on a list, the settings form offers choices instead of accepting arbitrary text. */
  options?: readonly string[];
  /** Smallest permitted list size. Constrained lists can use this to prevent an unusable empty value. */
  minItems?: number;
}

/**
 * Everything the settings form needs to render one adapter, served at runtime rather than
 * compiled into the client, so an adapter that arrived from a plugin looks like any other.
 */
export interface IndexerAdapterDescriptor {
  type: IndexerAdapterTypeName;
  label: string;
  /** False for an adapter loaded from the plugin directory, which the settings page says plainly. */
  builtIn: boolean;
  /** The plugin release. Omitted by built-ins and legacy plugins that do not declare one. */
  version?: string;
  requiresCredential: boolean;
  credentialKind: "apiKey" | "sessionId" | null;
  mediaKinds: BookRequestMediaKind[];
  usesCategories: boolean;
  seedsBack: boolean;
  /**
   * Whether this adapter can search an ISBN at all. The operator decides per source whether it
   * should, because a catalogue that answers an ISBN badly is worse than one that cannot.
   */
  supportsIsbnSearch: boolean;
  defaultCategories: IndexerCategoryMap;
  defaultBaseUrl?: string;
  /** Only a plugin sends one; a built-in has a translated message keyed on its type. */
  baseUrlHint?: string;
  settingsFields: IndexerSettingsField[];
}

/**
 * What an uploaded plugin says it is, read in a child process before the file is kept anywhere.
 *
 * Carries the source back with it on purpose: installing a plugin runs its code in the BookOrbit
 * process, and one dependency-free file is exactly what makes reading it first realistic.
 */
export interface PluginInspection {
  type: string;
  label: string;
  /** The plugin release. Omitted by plugins written before versions were exposed. */
  version?: string;
  requiresCredential: boolean;
  credentialKind: "apiKey" | "sessionId" | null;
  mediaKinds: BookRequestMediaKind[];
  usesCategories: boolean;
  seedsBack: boolean;
  defaultBaseUrl?: string;
  baseUrlHint?: string;
  settingsFields: IndexerSettingsField[];
  /** The file as uploaded, for the operator to read before confirming. */
  source: string;
  /** Whether a plugin of this type is already installed, so the confirmation can say "replace". */
  replaces: boolean;
}

/**
 * The outcome of an install. A plugin is put to work in the running process as soon as it is
 * written, so `active` is normally true and the page needs to say nothing about restarting; it is
 * false only when the file is on disk but would not load here, which a restart will retry.
 */
export interface PluginInstallResult extends PluginInspection {
  active: boolean;
}

/** A plugin that would not load, so the settings page can say which file failed and why. */
export interface IndexerPluginFailure {
  directory: string;
  reason: string;
}

export const INDEXER_ERROR_CODES = [
  "INDEXER_NAME_TAKEN",
  "INDEXER_URL_UNSAFE",
  "INDEXER_URL_PRIVATE",
  "INDEXER_CREDENTIAL_REQUIRED",
  "INDEXER_SETTINGS_INVALID",
  /** The test ran and the source refused or could not be reached. Carries the adapter's reason. */
  "INDEXER_TEST_FAILED",
  ...REQUEST_CREDENTIAL_ERROR_CODES,
] as const;
export type IndexerErrorCode = (typeof INDEXER_ERROR_CODES)[number];

export interface IndexerItem {
  id: number;
  name: string;
  /** The operator's own colour for this source, or null while it has not been given one. */
  color: IndexerColor | null;
  adapterType: IndexerAdapterTypeName;
  enabled: boolean;
  baseUrl: string;
  /** The key itself never leaves the server; this only says whether one is stored. */
  hasCredential: boolean;
  /**
   * Off by default, unlike a download client: a public tracker has no business resolving to a
   * private address. A self-hosted torznab proxy such as Jackett or Prowlarr is the one common
   * exception, so it is an explicit per-row opt-in rather than a blanket relaxation.
   */
  allowPrivateAddress: boolean;
  categories: IndexerCategoryMap;
  /**
   * Media this source is not to be searched for, on the operator's say-so rather than the
   * adapter's. An audiobook-only tracker behind a general torznab proxy is still declared as
   * carrying all three, and searching it for ebooks costs a request and a slot in the merge.
   *
   * Stated as an opt-out so a row written before a new medium existed is not silently excluded
   * from it, and because "search everything" is the state an operator who has never opened this
   * expects. An empty category list cannot express it: torznab reads that as "send no `cat`",
   * which most trackers answer with their whole catalogue.
   */
  disabledMediaKinds: BookRequestMediaKind[];
  /**
   * Whether to stop handing this source an ISBN when the request states one, leaving it the title
   * and author every other source gets.
   *
   * An opt-out for the same reason media kinds are: searching the identifier is the better default
   * where a catalogue indexes it well. It is worth turning off where one does not, because an ISBN
   * a catalogue holds against the wrong row returns a confidently wrong book, and no adapter can
   * tell that from a right one. Ignored by a source whose adapter never searches an ISBN.
   */
  isbnSearchDisabled: boolean;
  /** Adapter-specific knobs. Always an object, so the form never guards on null before reading. */
  settings: IndexerSettings;
  /** How the server reaches this source, where the default path does not work. */
  networkProfile: NetworkProfile | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastErrorMessage: string | null;
  /**
   * How the last real search against this source went, which is a different question from the
   * last time somebody pressed Test: a caps call can succeed against a tracker that has refused
   * every search for a week. Null until this source has been searched at least once.
   */
  lastSearchAt: string | null;
  lastSearchOk: boolean | null;
  lastSearchError: string | null;
  /** Consecutive failed searches, reset by any success. One failure is noise; a run of them is not. */
  searchFailureStreak: number;
  createdAt: string;
  updatedAt: string;
}

/** The list plus the one instance fact the form needs up front: can a credential be stored at all. */
export interface IndexerListResult {
  indexers: IndexerItem[];
  encryptionConfigured: boolean;
}

/** What this install can offer, and what it tried and failed to offer. */
export interface IndexerAdapterListResult {
  adapters: IndexerAdapterDescriptor[];
  pluginFailures: IndexerPluginFailure[];
}

export interface CreateIndexerPayload {
  name: string;
  adapterType: IndexerAdapterTypeName;
  baseUrl: string;
  /** Null clears the colour, returning the source to the neutral chip. */
  color?: IndexerColor | null;
  credential?: string | null;
  enabled?: boolean;
  allowPrivateAddress?: boolean;
  categories?: Partial<IndexerCategoryMap>;
  disabledMediaKinds?: BookRequestMediaKind[];
  isbnSearchDisabled?: boolean;
  settings?: IndexerSettings;
  networkProfile?: NetworkProfile | null;
}

export type UpdateIndexerPayload = Partial<CreateIndexerPayload>;

export interface IndexerTestResult {
  success: boolean;
  /** What answered, when the indexer names itself. */
  indexerName?: string;
  error?: string;
}

/**
 * Why a release scored the way it did, as a code plus its signed contribution, so the picker can
 * show the reasoning in the reader's own language rather than an English sentence from the server.
 */
export const RELEASE_SCORE_REASONS = [
  "isbnMatch",
  "titleMatch",
  "authorMatch",
  "preferredFormat",
  "knownFormat",
  "unknownFormat",
  "expectedSize",
  "suspiciousSize",
  "seeders",
  "freeleech",
  "likelySeveralBooks",
] as const;
export type ReleaseScoreReasonCode = (typeof RELEASE_SCORE_REASONS)[number];

export interface ReleaseScoreReason {
  code: ReleaseScoreReasonCode;
  /** Signed contribution to the final score, already rounded. */
  points: number;
  /** A value the copy interpolates, such as a format or a seeder count. Never translated. */
  detail?: string;
}

/**
 * What an indexer publishes about a release's audio, where it publishes anything at all. Every
 * field is independently optional: coverage is partial even on a tracker that reports it, and a
 * missing figure must read as "not stated" rather than as a bad one.
 */
export interface ReleaseAudioInfo {
  bitrateKbps: number | null;
  /** "CBR" or "VBR", as the indexer words it. Never translated. */
  bitrateMode: string | null;
  channels: number | null;
  samplingRateHz: number | null;
  /**
   * Only where it describes the whole release. A tracker scans one file of a multi-file set and
   * reports seventeen seconds for a sixteen-hour book, so an implausible figure is dropped.
   */
  durationSeconds: number | null;
  chapterCount: number | null;
}

/**
 * A scored release as the picker sees it. Deliberately carries no download URL: a grab names the
 * indexer and the release, and the server resolves the URL from its own search results, so a
 * client can never point the download client at an address it chose.
 */
export interface ReleaseCandidateItem {
  indexerId: number;
  indexerName: string;
  guid: string;
  title: string;
  sizeBytes: number | null;
  /** Null where the indexer did not report a swarm count at all, which is not the same as zero. */
  seeders: number | null;
  leechers: number | null;
  /** The primary format, preferred-first, for anywhere a single value is all that fits. */
  format: string | null;
  /**
   * Every format the release claims. A tracker that lists "azw3 epub mobi" is describing one book
   * in three formats, and carrying only the first hid such a release from a filter on a format it
   * actually contains, while labelling it with whichever one the tracker happened to list first.
   */
  formats: string[];
  language: string | null;
  /**
   * How many files the release carries, where the indexer states a count. Null is "not stated",
   * which is not one file: a tier asking for a single file must not match a release whose source
   * publishes no count at all.
   *
   * Counts everything the release holds, cover art and sidecars included, so it is a signal rather
   * than a promise. The exact primary-file count needs the manifest, which costs a credentialed
   * fetch per release and so belongs to inspection, not to search.
   */
  fileCount: number | null;
  freeleech: boolean;
  /** The tracker will refuse the download outright unless the account is VIP. */
  vipOnly: boolean;
  /**
   * The account behind this indexer has already snatched this release, where the source says so.
   * Marked on the row and never filtered on: sources report it on a delay of minutes.
   */
  alreadyGrabbed: boolean;
  publishedAt: string | null;
  /** Null where the indexer said nothing about the audio, which includes every ebook release. */
  audio: ReleaseAudioInfo | null;
  score: number;
  /**
   * Which profile tier this release fell into, best being 0, or null for none. Null where the
   * medium has no profile at all, in which case the picker shows no tier and score alone orders
   * the list, exactly as before profiles existed.
   */
  tier: number | null;
  /** The operator's own name for that tier, carried so the row need not resolve it. */
  tierName: string | null;
  reasons: ReleaseScoreReason[];
}

/** Distinct enough to act on: an expired tracker session must not look like "nothing found". */
export const INDEXER_SEARCH_FAILURES = ["unauthorized", "throttled", "timeout", "unreachable", "unsupportedMedium", "error"] as const;
export type IndexerSearchFailure = (typeof INDEXER_SEARCH_FAILURES)[number];

export interface IndexerSearchQuery {
  kind: "isbn" | "titleAuthor";
  /** The exact ISBN or text sent to this indexer. */
  value: string;
}

export interface IndexerSearchStatus {
  indexerId: number;
  indexerName: string;
  /**
   * The source's assigned colour, carried alongside the name for the same reason `seedsBack` is:
   * it belongs to the source, not to the release, and repeating it on all hundred merged releases
   * would send the same slug a hundred times. Null where the operator has assigned none.
   */
  color: IndexerColor | null;
  ok: boolean;
  /** Releases this indexer contributed after the hard filters. */
  count: number;
  /** Releases it returned that the hard filters dropped, so an empty list stays explainable. */
  filtered: number;
  /** The one query this indexer executed. Omitted only when no matching adapter was installed. */
  query?: IndexerSearchQuery;
  failure?: IndexerSearchFailure;
  error?: string;
  /**
   * Whether a grab from this source joins a swarm, read off the adapter rather than the row. It
   * lives here rather than on every release because it is a property of the source: it lets the
   * picker tell "this release omitted its seeder count" from "this source publishes none", which
   * are the same silence and completely different facts.
   */
  seedsBack: boolean;
}

/** Request metadata used across indexer retrieval, hard filters, and release scoring. */
export interface ReleaseSearchCriteria {
  title: string;
  authors: string[];
  isbn10: string | null;
  isbn13: string | null;
  /** The one canonical ISBN-13 used for this search, or null for a title and author search. */
  activeIsbn: string | null;
  /** Other canonical ISBN-13 values retained as explicit searches the user can try next. */
  isbns: string[];
  mediaKind: BookRequestMediaKind;
  language: string | null;
  preferredFormats: string[];
}

/** Explicit search inputs supplied from the release picker instead of the request snapshot. */
export interface ReleaseSearchOverrides {
  title?: string;
  authors?: string[];
  /** One canonical ISBN-13. Null explicitly selects a title and author search. */
  isbn?: string | null;
  /** Null explicitly removes the request language filter. */
  language?: string | null;
  preferredFormats?: string[];
}

export interface ReleaseSearchResult {
  releases: ReleaseCandidateItem[];
  criteria: ReleaseSearchCriteria;
  /** One entry per indexer that was actually searched, including the ones that failed. */
  indexers: IndexerSearchStatus[];
  /**
   * Enabled indexers that do not carry the requested medium, and so were never searched. Neither a
   * status nor a failure: nothing went wrong, and the mismatch is a permanent property of the
   * source known before any request. Counted only, so an empty list can distinguish "nothing you
   * have configured carries this" from "this book was not found".
   */
  uncoveredIndexerCount: number;
  /**
   * Enabled indexers at the time of the search, counted before the medium filter. Zero means
   * nothing was searched at all, which is a different sentence from "this book was not found" and
   * the only way the picker can tell them apart: the indexer list itself is admin-only.
   */
  enabledIndexerCount: number;
  /**
   * Indexer rows that exist, enabled or not. Separates "none configured" from "all switched off",
   * because the second is a toggle away and telling that operator to add a source is telling them
   * to duplicate one they already have.
   */
  configuredIndexerCount: number;
  /**
   * Whether the requested medium has a release profile at all.
   *
   * The picker cannot work this out from the rows. A profile that nothing matched returns every
   * release untiered, which is byte-for-byte what no profile returns - and those two states need
   * opposite explanations, because one of them means the automation will grab nothing.
   */
  profileActive: boolean;
  searchedAt: string;
  /** True when this came from the short-lived cache rather than a fresh hit on every tracker. */
  cached: boolean;
}

/**
 * How many search sources this instance has, readable by anybody who may file a request.
 *
 * Counts only, deliberately: names, addresses and credentials stay behind `ManageAppSettings`,
 * and a requester needs no more than this to be told whether their request has anywhere to be
 * fulfilled from.
 */
export interface BookRequestSourceStatus {
  /** Indexer rows that exist, enabled or not. */
  configured: number;
  /** Of those, the ones switched on. Zero means nothing will ever be searched. */
  enabled: number;
}

export interface InspectBookRequestReleasePayload {
  indexerId: number;
  releaseGuid: string;
}

export const RELEASE_FILE_INSPECTION_STATUSES = [
  "ready",
  "no_supported_file",
  "multiple_supported_files",
  "metadata_unavailable",
  /** Packaged as RAR, ZIP or 7z: the layout is unknowable until it has been extracted. */
  "contents_unknown",
] as const;
export type ReleaseFileInspectionStatus = (typeof RELEASE_FILE_INSPECTION_STATUSES)[number];

/**
 * Whether a release in this state must not be sent to a download client. Only one is: a release
 * with no book file in it can never become an import, so sending it only wastes a download.
 *
 * Everything else is sent. A magnet's layout is unknowable until the swarm answers and an
 * archive's until it is opened, and a release holding several books is a question an approver
 * answers once it has landed rather than a reason to throw the download away.
 *
 * Shared so the button that hides a grab and the guard that refuses one cannot drift apart.
 */
export function releaseInspectionBlocksGrab(status: ReleaseFileInspectionStatus | undefined): boolean {
  return status === "no_supported_file";
}

export interface ReleaseManifestFile {
  /** A path from untrusted torrent metadata, sanitized and bounded before it reaches the client. */
  path: string;
  sizeBytes: number | null;
  bookFile: boolean;
}

export type ReleaseUnitMediaKind = "ebook" | "audiobook" | "comic";

/**
 * One book the release resolves to. This is what lets the picker say "one audiobook of 31 tracks"
 * rather than "31 supported book files", and it is what a later chooser selects between.
 */
export interface ReleaseUnitSummary {
  mediaKind: ReleaseUnitMediaKind;
  /** Best guess from the folder or file name, for display only. Never used for matching. */
  title: string | null;
  /** Content files only. Exact, and not derived from the bounded `files` display list. */
  contentFileCount: number;
  /** Content files plus the artwork and sidecars that travel with them. */
  totalFileCount: number;
  sizeBytes: number | null;
}

/**
 * One candidate a release resolved to when it holds several distinct books. Carried on the
 * download attempt so an approver can choose between them after the bytes have landed: failing
 * instead would throw away a finished download over a question a human answers in seconds.
 */
export interface ReleaseUnitChoice extends ReleaseUnitSummary {
  /** Position in the stored list. What the chooser route selects by. */
  index: number;
  /**
   * The unit's primary file, relative to the release root. This is what a re-read of the release
   * is matched against, so a choice survives the list being rebuilt. A path within the release, not
   * a path on the server.
   */
  primaryPath: string;
}

/** The safe, credential-free result of inspecting one selected release server-side. */
export interface ReleaseFileInspection {
  source: BookRequestDownloadSource;
  status: ReleaseFileInspectionStatus;
  files: ReleaseManifestFile[];
  /** Exact when non-null, including entries omitted from the bounded display list. */
  totalFiles: number | null;
  primaryFileCount: number | null;
  truncated: boolean;
  /** Bounded for display; `unitCount` is the exact figure. Empty when the layout is unknown. */
  units: ReleaseUnitSummary[];
  unitCount: number;
  /** Files the interpreter discarded: samples, padding, junk directories. */
  ignoredFileCount: number;
  /** Archives found in the release. Non-zero with no units is what `contents_unknown` means. */
  containerCount: number;
}
