/**
 * The contract between BookOrbit and an indexer plugin loaded from disk.
 *
 * This package exists so that a plugin maintained in another repository can typecheck against a
 * versioned surface instead of against BookOrbit's internals. Nothing here is tracker-specific,
 * and BookOrbit ships no plugin of its own: the loader is the extension point, the plugins are
 * somebody else's.
 *
 * Deliberately dependency-free and free of runtime classes. A plugin is imported at runtime and
 * therefore gets its own copy of anything it imports, so `instanceof` across the boundary cannot
 * be relied on; every failure travels through `host.fail` instead.
 */

/** Bumped when a change to this contract would break a plugin written against the old one. */
export const PLUGIN_API_VERSION = 1;

export type PluginMediaKind = "ebook" | "audiobook" | "comic";

/** Distinct enough to act on: a rejected credential must not look like "nothing found". */
export type PluginSearchFailure = "unauthorized" | "throttled" | "timeout" | "unreachable" | "unsupportedMedium" | "error";

/** What an indexer's credential field holds, or null where the source needs no account. */
export type PluginCredentialKind = "apiKey" | "sessionId" | null;

export interface PluginCategoryMap {
  ebook: number[];
  audiobook: number[];
  comic: number[];
}

/** What a request is looking for, already normalised by BookOrbit. */
export interface PluginReleaseQuery {
  title: string;
  author: string | null;
  isbn13: string | null;
  /** Compatibility alias containing either the active ISBN or no values. */
  isbn13s: string[];
  mediaKind: PluginMediaKind;
  /** The language the request asked for. A hard filter, but only where a release states one. */
  language: string | null;
  limit: number;
}

/** One configured indexer row, with its credential already decrypted. Never log this. */
export interface PluginIndexerConfig {
  id: number;
  name: string;
  baseUrl: string;
  credential: string | null;
  allowPrivateAddress: boolean;
  categories: PluginCategoryMap;
  /** Whatever the plugin declared in `settingsFields`, already validated against that schema. */
  settings: Record<string, unknown> | null;
}

/** Audio characteristics, where a source publishes them. Shown and sorted on, never scored. */
export interface PluginAudioInfo {
  bitrateKbps: number | null;
  bitrateMode: string | null;
  channels: number | null;
  samplingRateHz: number | null;
  durationSeconds: number | null;
  chapterCount: number | null;
}

/**
 * One release as a source describes it. Everything past `title` is optional because sources
 * differ wildly in what they expose, and scoring degrades rather than rejecting a sparse row.
 */
export interface PluginReleaseCandidate {
  /** Stable within this indexer, and how a grab names the release it wants. */
  guid: string;
  title: string;
  /** The bare work title where the source publishes one; scored against, never displayed. */
  bookTitle?: string;
  downloadUrl?: string;
  magnet?: string;
  infoHash?: string;
  sizeBytes: number | null;
  /**
   * Null means the source reported no swarm counts, which must not be read as zero: the
   * zero-seeder hard filter would then drop every release from a source that omits the field.
   */
  seeders: number | null;
  leechers: number | null;
  format?: string;
  language?: string;
  author?: string;
  /**
   * An identifier the source states for the edition, where it states one. Never trusted to be an
   * ISBN: MyAnonaMouse returns `ASIN:B08G9PRS1K` in the same field, which normalisation rejects.
   */
  isbn?: string;
  freeleech?: boolean;
  /**
   * The account behind this indexer has already downloaded this release, where the source says so.
   * Advisory only: sources report it on a delay, so it marks a row and never filters one.
   */
  alreadyGrabbed?: boolean;
  /** The source will refuse the download outright unless the account is privileged. */
  vipOnly?: boolean;
  publishedAt?: string;
  audio?: PluginAudioInfo;
  /** Primary-format files this release carries, where the source exposes a real file list. */
  primaryFileCount?: number;
  /** Total files, where the source reports only a count. A scoring penalty, not a filter. */
  fileCount?: number;
  seedRatioGoal?: number;
  seedTimeMinutes?: number;
}

/** One file, for a source that serves the file itself rather than a torrent. */
export interface PluginReleaseFile {
  url: string;
  fileName: string;
  sizeBytes: number | null;
  format: string;
}

export interface PluginTestResult {
  success: boolean;
  /** What answered, when the source names itself. */
  indexerName?: string;
  error?: string;
}

/** One configurable field a plugin wants on the settings form, beyond the shared ones. */
export interface PluginSettingsField {
  key: string;
  type: "boolean" | "string" | "number";
  /** Untranslated English: plugin strings cannot go through the translation workflow. */
  label: string;
  hint?: string;
  default?: boolean | string | number;
  /** Edit a comma-separated string as a collection instead of exposing its punctuation. */
  format?: "list";
  /** When present on a list, the UI only permits these canonical values. */
  options?: readonly string[];
  /** Smallest permitted list size. Requires `options` so the limit can be enforced safely. */
  minItems?: number;
}

/**
 * Everything BookOrbit lends a plugin. A plugin must reach for these rather than Node's own
 * globals: `host.fetch` is the only path that enforces the address checks, the size limits and
 * the per-request deadline that keep a hostile or misconfigured source from reaching the network
 * it should not.
 */
export interface PluginHost {
  /**
   * Checked against the indexer's private-address policy, given the caller's deadline, and
   * bounded. Throws whatever `fail` produces on a refusal.
   */
  fetch(url: string, init?: PluginRequestInit): Promise<Response>;
  /** Values interpolated into a message are sanitized by the host before they reach a log. */
  logger: {
    log(message: string): void;
    warn(message: string): void;
  };
  /**
   * The search text BookOrbit would use itself: parentheticals stripped, author appended. Sources
   * that AND their terms answer a decorated title with nothing at all.
   */
  buildSearchText(query: PluginReleaseQuery): string;
  /**
   * Store a credential the source rotated out from under the stored one. Without this a rotated
   * session lives only in memory and stops working at the next restart.
   */
  saveCredential(credential: string): Promise<void>;
  /**
   * Build the error a plugin should throw. A function rather than an exported class because a
   * plugin imported at runtime holds a different copy of any class, so `instanceof` would not
   * survive the boundary and the failure code would be lost.
   */
  fail(failure: PluginSearchFailure, message: string): Error;
}

export interface PluginRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Defaults to following redirects, each hop checked. */
  redirect?: "follow" | "manual";
}

/**
 * What a plugin module's default export must look like. Everything the settings form needs is
 * declared here, so a plugin-supplied source is indistinguishable from a built-in one to the
 * client.
 */
export interface IndexerPlugin {
  /** Must equal `PLUGIN_API_VERSION`; the loader refuses a mismatch and says so. */
  apiVersion: number;
  /** The plugin release, without a leading `v`. Optional for plugins written before versions were exposed. */
  version?: string;
  /** A slug. May not collide with a built-in type name, and must match `^[a-z0-9][a-z0-9-]{0,29}$`. */
  type: string;
  /** Untranslated English, shown in the indexer type list. */
  label: string;
  requiresCredential: boolean;
  credentialKind: PluginCredentialKind;
  /** Which media this source can answer for at all. */
  mediaKinds: readonly PluginMediaKind[];
  /** Whether this plugin uses `isbn13` when present instead of the title and author text. */
  supportsIsbnSearch?: boolean;
  /** Whether the source is searched by numeric category, which decides if the editor shows. */
  usesCategories: boolean;
  defaultCategories?: PluginCategoryMap;
  /** Whether a grab joins a swarm, which decides whether seed goals mean anything. */
  seedsBack: boolean;
  /** Prefilled into the form when adding one. */
  defaultBaseUrl?: string;
  baseUrlHint?: string;
  settingsFields?: readonly PluginSettingsField[];

  search(query: PluginReleaseQuery, config: PluginIndexerConfig, host: PluginHost, signal: AbortSignal): Promise<PluginReleaseCandidate[]>;
  test(config: PluginIndexerConfig, host: PluginHost): Promise<PluginTestResult>;
  /** A source whose download link is credentialed and must be fetched with its own session. */
  fetchTorrentFile?(release: PluginReleaseCandidate, config: PluginIndexerConfig, host: PluginHost): Promise<Uint8Array>;
  /** A source that serves the file itself. Declare this or `fetchTorrentFile`, never both. */
  resolveFile?(release: PluginReleaseCandidate, config: PluginIndexerConfig, host: PluginHost, signal: AbortSignal): Promise<PluginReleaseFile>;
  /** Sources whose session expires on its own clock, called on a schedule while enabled. */
  keepalive?(config: PluginIndexerConfig, host: PluginHost): Promise<void>;
}
