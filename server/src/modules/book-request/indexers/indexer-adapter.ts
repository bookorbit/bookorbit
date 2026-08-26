import type {
  BookRequestMediaKind,
  IndexerSettingsField,
  IndexerAdapterType,
  IndexerCategoryMap,
  IndexerColor,
  IndexerSearchFailure,
  IndexerSettings,
  IndexerTestResult,
  NetworkProfile,
  ReleaseAudioInfo,
} from '@bookorbit/types';

/** An indexer row with its credential already decrypted. Never logged, never returned over HTTP. */
export interface ResolvedIndexerConfig {
  id: number;
  name: string;
  /** The operator's colour for this source, carried so a search status can report it unlooked-up. */
  color: IndexerColor | null;
  adapterType: IndexerAdapterType;
  baseUrl: string;
  /** A torznab API key or a tracker session id, depending on the adapter. */
  credential: string | null;
  /**
   * Why the stored credential could not be read, where that is what happened. Set only on the
   * batch resolve behind a search: a rotated or unset encryption key must not abort a fan-out over
   * every other source, so the row is searched-as-refused rather than left out or thrown over.
   * Null everywhere else, including on the single-indexer resolve, which throws instead.
   */
  credentialError: string | null;
  allowPrivateAddress: boolean;
  categories: IndexerCategoryMap;
  /** Media the operator took this source out of, on top of what its adapter declares it carries. */
  disabledMediaKinds: readonly BookRequestMediaKind[];
  /**
   * Whether the operator has taken the ISBN away from this source. Applied by withholding it from
   * the query rather than by asking the adapter to ignore one, so an adapter that searches an ISBN
   * alongside the title and author is turned off just as completely as one that only searches it.
   */
  isbnSearchDisabled: boolean;
  settings: IndexerSettings | null;
  /** How to reach this source, applied by the host rather than chosen by the adapter. */
  networkProfile: NetworkProfile | null;
}

export interface ReleaseQuery {
  title: string;
  author: string | null;
  isbn13: string | null;
  /** Every canonical ISBN accepted for the work. `isbn13` remains the first for older plugins. */
  isbn13s: string[];
  mediaKind: BookRequestMediaKind;
  /** Language the request asked for, as a hard filter when the release states one. */
  language: string | null;
  limit: number;
}

/**
 * One release as an indexer describes it. Everything past `title` is optional because trackers
 * differ wildly in what they expose, and scoring has to degrade rather than reject a sparse row.
 */
export interface ReleaseCandidate {
  indexerId: number;
  /** Stable within an indexer, and how a grab names the release it wants. */
  guid: string;
  title: string;
  /**
   * The bare work title, where the indexer publishes one alongside the decorated release name.
   * Scored against instead of `title`, never displayed: the release name is what carries the
   * language and format flags an approver reads.
   */
  bookTitle?: string;
  downloadUrl?: string;
  magnet?: string;
  infoHash?: string;
  sizeBytes: number | null;
  /**
   * Null means the indexer reported no swarm counts, which must not be read as zero seeders: the
   * zero-seeder hard filter would then drop every release from an indexer that omits the field.
   */
  seeders: number | null;
  leechers: number | null;
  format?: string;
  language?: string;
  author?: string;
  /**
   * An identifier the indexer states for the edition. Deliberately not typed as an ISBN:
   * MyAnonaMouse returns `ASIN:B08G9PRS1K` in the same field, and normalisation rejects it.
   */
  isbn?: string;
  freeleech?: boolean;
  /**
   * The account behind this indexer has already snatched this release, where the source says so.
   * Shown on the row and never filtered on: sources report it minutes late.
   */
  alreadyGrabbed?: boolean;
  /**
   * The tracker answers the download link with a refusal unless the account is VIP, so the picker
   * marks the release rather than letting the approver find out at grab time.
   */
  vipOnly?: boolean;
  publishedAt?: string;
  /** Where the indexer publishes audio characteristics. Shown and sorted on, never scored. */
  audio?: ReleaseAudioInfo;
  /**
   * Primary-format files this release carries, where the indexer exposes an actual file list.
   * Undefined means it did not, and the multi-file check falls through to import time.
   */
  primaryFileCount?: number;
  /**
   * Total files, where the indexer reports only a count. Weaker than `primaryFileCount`, since a
   * cover image counts too, so it is a scoring penalty rather than a hard filter.
   */
  fileCount?: number;
  /**
   * Seeding the tracker requires of this release, where it states them. A default only: the
   * operator's own per-indexer figures win, since those are a deliberate choice and these are
   * merely what the tracker asks for.
   */
  seedRatioGoal?: number;
  seedTimeMinutes?: number;
}

/**
 * A failure the picker can act on. An expired tracker session must never reach the UI as an
 * empty result list, which is exactly how MyAnonaMouse reports one.
 */
export class IndexerSearchException extends Error {
  constructor(
    readonly failure: IndexerSearchFailure,
    message: string,
  ) {
    super(message);
    this.name = 'IndexerSearchException';
  }
}

/** One file, resolved from a release that is served over plain HTTP rather than as a torrent. */
export interface ReleaseFile {
  url: string;
  fileName: string;
  /** Known here even where the search could not state one, since a single file has a real size. */
  sizeBytes: number | null;
  format: string;
}

export interface IndexerAdapter {
  readonly type: IndexerAdapterType;
  readonly label: string;
  /**
   * Which media this source can answer for. A source asked for one it does not serve is reported
   * as not covering it, rather than contributing an empty list that reads as "nothing exists".
   */
  readonly mediaKinds: readonly BookRequestMediaKind[];
  /** Whether an ISBN replaces the title and author query when one is active. */
  readonly supportsIsbnSearch: boolean;
  /**
   * Extra settings this adapter reads. The list is what the form renders and what the service
   * whitelists against, so an adapter that declares nothing can store nothing.
   */
  readonly settingsFields?: readonly IndexerSettingsField[];
  /**
   * Whether the adapter can do anything at all without one. A private tracker cannot, and saving
   * a row that every search will reject is worth refusing at the form rather than discovering in
   * the picker.
   */
  readonly requiresCredential: boolean;

  /** The signal carries the per-indexer timeout, so one slow tracker cannot hold up the merge. */
  search(query: ReleaseQuery, config: ResolvedIndexerConfig, signal: AbortSignal): Promise<ReleaseCandidate[]>;
  test(config: ResolvedIndexerConfig): Promise<IndexerTestResult>;
  /** Private trackers need an authenticated .torrent fetch rather than a public magnet. */
  fetchTorrentFile?(release: ReleaseCandidate, config: ResolvedIndexerConfig): Promise<Buffer>;
  /**
   * Sources that serve the file itself. An adapter implements this or `fetchTorrentFile`, never
   * both: which one it declares is what decides whether a grab becomes a torrent or a download.
   */
  resolveFile?(release: ReleaseCandidate, config: ResolvedIndexerConfig, signal: AbortSignal): Promise<ReleaseFile>;
  /**
   * Trackers whose session expires on its own clock. Called on a schedule for every enabled row
   * of this type, so a session does not lapse between one approval and the next.
   */
  keepalive?(config: ResolvedIndexerConfig): Promise<void>;
  /** Drop anything cached against this indexer id when its URL or credential changes. */
  forget?(indexerId: number): void;
}

export const INDEXER_ADAPTERS = Symbol('INDEXER_ADAPTERS');
