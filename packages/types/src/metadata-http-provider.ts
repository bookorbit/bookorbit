import type { ExternalMetadataProviderKey } from "./metadata-fetch";
import type { MetadataField } from "./metadata-preferences";

/**
 * An external metadata provider: an HTTP service an admin registered, speaking the community
 * book-metadata-provider spec (https://github.com/FlyinPancake/book-metadata-provider) plus the
 * optional extensions BookOrbit reads. BookOrbit never runs its code; the spec is the only coupling.
 */

export const METADATA_HTTP_PROVIDER_STATUSES = ["ok", "stale", "unreachable", "key_changed", "incompatible"] as const;

/**
 * - `ok`: the last `/provider/info` answered and validated.
 * - `stale`: the last refresh failed; the provider keeps serving with the info it had.
 * - `unreachable`: several refreshes in a row failed; it is out of searches until one succeeds.
 * - `key_changed`: the provider now reports a different key; out of searches until re-registered,
 *   because its stored ids, ratings and field rules are filed under the old key.
 * - `incompatible`: it answered with info BookOrbit cannot use (no usable key, bad types).
 */
export type MetadataHttpProviderStatus = (typeof METADATA_HTTP_PROVIDER_STATUSES)[number];

export type MetadataHttpProviderMediaType = "book" | "audiobook" | "comic";

/** What the provider said about itself, normalized and bounded. Unknown fields are dropped. */
export interface MetadataHttpProviderInfo {
  key: ExternalMetadataProviderKey;
  name: string;
  version: string | null;
  specVersion: string;
  avatarUrl: string | null;
  authenticationRequired: boolean;
  mediaTypes: MetadataHttpProviderMediaType[];
  lookup: boolean;
  /** Field-rule fields it fills, when it says. Null means "every field the spec maps". */
  supportedFields: MetadataField[] | null;
  searchParams: string[];
  idMaxLength: number;
  bookUrlTemplate: string | null;
  rateLimit: { maxConcurrency: number; minIntervalMs: number };
  coverShape: "portrait" | "square" | null;
  /** Brand colour as `#rrggbb`. Info stored before colours existed has none. */
  color?: string | null;
}

/** Icons BookOrbit downloads from a provider's `avatarUrl` are at most this size. SVG is never accepted. */
export const METADATA_HTTP_PROVIDER_ICON_MAX_BYTES = 256 * 1024;

/** One registered provider as the settings page sees it. The authorization header is never sent back. */
export interface MetadataHttpProviderView {
  id: number;
  key: ExternalMetadataProviderKey;
  baseUrl: string;
  hasAuthorization: boolean;
  /** A header is saved but no longer decrypts (the encryption key changed), so it is never searched. */
  authorizationUnreadable: boolean;
  enabled: boolean;
  allowPrivateAddress: boolean;
  timeoutMs: number;
  status: MetadataHttpProviderStatus;
  lastError: string | null;
  info: MetadataHttpProviderInfo | null;
  /** BookOrbit's own copy of the provider's icon, versioned; null when it declares none or it could not be used. */
  iconUrl: string | null;
  infoFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMetadataHttpProviderPayload {
  baseUrl: string;
  /** The full `Authorization` header value, sent as given. */
  authorization?: string | null;
  allowPrivateAddress?: boolean;
  timeoutMs?: number;
}

export interface UpdateMetadataHttpProviderPayload {
  baseUrl?: string;
  /** A string replaces the stored header, null clears it, absent keeps it. */
  authorization?: string | null;
  allowPrivateAddress?: boolean;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface MetadataHttpProviderTestResult {
  ok: boolean;
  name: string | null;
  version: string | null;
  latencyMs: number;
  resultCount: number | null;
  sampleTitle: string | null;
  error: string | null;
}

export const METADATA_HTTP_PROVIDER_TIMEOUT_MS = { min: 2_000, default: 10_000, max: 30_000 } as const;

/**
 * A ready-made provider an admin can run beside BookOrbit. The list is read from the
 * bookorbit-metadata-providers repository, so a provider published after a release still shows up.
 */
export interface MetadataProviderDirectoryEntry {
  /** The key it registers under, and the Compose service name the snippet uses. */
  key: string;
  name: string;
  /** One or two sentences, in English: the directory is published content, not app copy. */
  summary: string;
  /** Without a tag, such as `ghcr.io/bookorbit/mangabaka-provider`. */
  image: string;
  /** The release to pin in the snippet. */
  version: string;
  port: number;
  docsUrl: string;
  homepage: string | null;
  color: string | null;
  mediaTypes: MetadataHttpProviderMediaType[];
  /** BCP 47 codes of the languages its books are mostly in; empty when it is not tied to one. */
  languages: string[];
}

export interface MetadataProviderDirectory {
  providers: MetadataProviderDirectoryEntry[];
  /** `bundled` is the copy shipped with this build: the online list is turned off or unreachable. */
  source: "remote" | "bundled";
  /** When the online list was last read; null for the bundled copy. */
  fetchedAt: string | null;
}
