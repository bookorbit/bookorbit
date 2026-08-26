import { REQUEST_CREDENTIAL_ERROR_CODES } from "./request-credential";
import type { IndexerColor, ReleaseUnitChoice } from "./indexer";

/**
 * External clients an operator configures. A direct file is fetched by BookOrbit itself and is
 * deliberately absent: it has no address, no credentials and nothing to choose, so making it a
 * configurable client type would only ask an operator to create a record of nothing.
 */
export const DOWNLOAD_CLIENT_TYPES = ["qbittorrent", "transmission", "deluge"] as const;
export type DownloadClientType = (typeof DOWNLOAD_CLIENT_TYPES)[number];

/**
 * What a client can be handed. A torrent client cannot fetch a URL and a plain downloader cannot
 * join a swarm, so this is what decides which configured client a given grab goes to rather than
 * simply taking the highest-priority enabled row.
 */
export type DownloadDelivery = "torrent" | "file";

export const DOWNLOAD_CLIENT_DELIVERY: Record<DownloadClientType, DownloadDelivery> = {
  qbittorrent: "torrent",
  transmission: "torrent",
  deluge: "torrent",
};

export interface DownloadClientPathMapping {
  id: number;
  /** The prefix the download client reports, in its own filesystem namespace. */
  remotePath: string;
  /** What BookOrbit has to open instead. Also the containment root for anything under it. */
  localPath: string;
}

export interface DownloadClientPathMappingInput {
  remotePath: string;
  localPath: string;
}

/**
 * Stable codes for the failures the settings form has to explain in the operator's own language.
 * The English `message` alongside them stays useful in logs and for anything unmapped.
 */
export const DOWNLOAD_CLIENT_ERROR_CODES = [
  "DOWNLOAD_CLIENT_NAME_TAKEN",
  "DOWNLOAD_CLIENT_URL_UNSAFE",
  "DOWNLOAD_CLIENT_URL_PRIVATE",
  "DOWNLOAD_CLIENT_PATH_NOT_ABSOLUTE",
  "DOWNLOAD_CLIENT_MAPPING_REQUIRED",
  /** The test ran and the client refused or could not be reached. Carries the adapter's reason. */
  "DOWNLOAD_CLIENT_TEST_FAILED",
  ...REQUEST_CREDENTIAL_ERROR_CODES,
] as const;
export type DownloadClientErrorCode = (typeof DOWNLOAD_CLIENT_ERROR_CODES)[number];

export interface DownloadClientItem {
  id: number;
  name: string;
  color: IndexerColor | null;
  adapterType: DownloadClientType;
  enabled: boolean;
  priority: number;
  baseUrl: string;
  username: string | null;
  /** The password itself never leaves the server; this only says whether one is stored. */
  hasPassword: boolean;
  category: string;
  useHardlinks: boolean;
  /** Download clients usually sit on the LAN, so reaching a private address is opt-in per row. */
  allowPrivateAddress: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastErrorMessage: string | null;
  pathMappings: DownloadClientPathMapping[];
  createdAt: string;
  updatedAt: string;
}

/**
 * What an approver is allowed to see: enough to pick a client, and nothing about how to reach it.
 * Managing the rows themselves needs `ManageAppSettings`; picking one needs only
 * `ManageBookRequests`, and a name is not a credential.
 */
export interface DownloadClientSummary {
  id: number;
  name: string;
  color: IndexerColor | null;
}

/**
 * The list plus the one piece of instance state the form needs up front: without an encryption
 * key a password cannot be stored, and saying so beats a 400 after the operator has typed one.
 */
export interface DownloadClientListResult {
  clients: DownloadClientItem[];
  encryptionConfigured: boolean;
}

export interface CreateDownloadClientPayload {
  name: string;
  color?: IndexerColor | null;
  adapterType: DownloadClientType;
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  enabled?: boolean;
  priority?: number;
  category?: string;
  useHardlinks?: boolean;
  allowPrivateAddress?: boolean;
  pathMappings?: DownloadClientPathMappingInput[];
}

export type UpdateDownloadClientPayload = Partial<CreateDownloadClientPayload>;

export interface DownloadClientTestResult {
  success: boolean;
  /** Client-reported version on success, so the operator can see what answered. */
  version?: string;
  error?: string;
}

/**
 * Whether a hardlink from this mapping into the Book Dock actually works, established by making
 * one rather than by comparing device ids: two bind mounts of one filesystem share a device and
 * still refuse the link. A refusal means every import copies instead, which is supported but
 * doubles the space.
 */
export const PATH_MAPPING_HARDLINK_FAILURES = ["download_dir_unwritable", "link_refused"] as const;

/** Why a link could not be made, as a stable code so the settings form can translate it. */
export type PathMappingHardlinkFailure = (typeof PATH_MAPPING_HARDLINK_FAILURES)[number];

export interface PathMappingHardlinkTestResult {
  localPathExists: boolean;
  bookDockPathExists: boolean;
  hardlinkWorks: boolean;
  failure?: PathMappingHardlinkFailure;
  /** The OS error behind `failure`, EXDEV or EPERM say. Shown verbatim; not translated. */
  errorCode?: string;
  /** Set only when the request itself failed, so the form can say something rather than nothing. */
  error?: string;
}

export const BOOK_REQUEST_DOWNLOAD_STATUSES = [
  "queued",
  "downloading",
  "completed",
  "importing",
  /** Imported, but the verification score held it in the Book Dock for a human to look at. */
  "needs_review",
  "imported",
  "failed",
] as const;
export type BookRequestDownloadStatus = (typeof BOOK_REQUEST_DOWNLOAD_STATUSES)[number];

/** Statuses the poll loop still has to ask the download client about. */
export const ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES: readonly BookRequestDownloadStatus[] = ["queued", "downloading"];

/**
 * Statuses that still have work behind them: a transfer running, or finished bytes waiting on an
 * import. Removing one of these from its client takes the attempt with it, because nothing is
 * going to finish it.
 */
export const IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES: readonly BookRequestDownloadStatus[] = ["queued", "downloading", "completed", "importing"];

/**
 * Statuses an attempt has not settled in. `imported` is finished with, and a `failed` one keeps
 * the reason it first failed for, which is the one that explains what happened; every write that
 * moves an attempt between states is conditional on it still being in one of these.
 */
export const UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES: readonly BookRequestDownloadStatus[] = [
  ...IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES,
  "needs_review",
];

export const BOOK_REQUEST_DOWNLOAD_SOURCES = ["magnet", "torrent_file", "direct_url"] as const;
export type BookRequestDownloadSource = (typeof BOOK_REQUEST_DOWNLOAD_SOURCES)[number];

/** Which kind of client can carry out a grab of each source. */
export const DELIVERY_BY_DOWNLOAD_SOURCE: Record<BookRequestDownloadSource, DownloadDelivery> = {
  magnet: "torrent",
  torrent_file: "torrent",
  direct_url: "file",
};

export interface BookRequestDownloadItem {
  id: number;
  requestId: number;
  downloadClientId: number | null;
  downloadClientName: string | null;
  downloadClientColor: IndexerColor | null;
  source: BookRequestDownloadSource;
  /** Where the release came from, and null once that indexer row has been deleted. */
  indexerId: number | null;
  indexerName: string | null;
  indexerColor: IndexerColor | null;
  /** True when the automation picked this release, which is also what makes it eligible to retry. */
  automated: boolean;
  releaseTitle: string;
  releaseSizeBytes: number | null;
  /** Null for an attempt a source refused before there was anything to download. */
  clientHash: string | null;
  status: BookRequestDownloadStatus;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  errorMessage: string | null;
  grabbedAt: string | null;
  completedAt: string | null;
  importedAt: string | null;
  createdAt: string;
  /**
   * Set only while the attempt is held because the release resolved to several distinct books.
   * Null everywhere else, including once one of them has been chosen.
   */
  releaseUnits: ReleaseUnitChoice[] | null;
}

export interface SelectReleaseUnitPayload {
  unitIndex: number;
}

/**
 * What the download client says about a torrent it is still seeding. Read live when an approver
 * opens a request rather than polled: a seed outlives the import by weeks, and a background poll
 * for every finished download would grow without bound.
 */
export interface BookRequestSeedStatus {
  downloadId: number;
  downloadClientId: number;
  downloadClientName: string | null;
  clientHash: string;
  /** False once the client has stopped the torrent, whether by goal, by pause or by error. */
  seeding: boolean;
  ratio: number | null;
  /** What the client was told to aim for at add time, when it reports one back. */
  ratioGoal: number | null;
  seedingTimeSeconds: number | null;
  seedingTimeGoalMinutes: number | null;
  uploadedBytes: number | null;
}

/**
 * Deleting the files is opt-in and separate: the seeded copy is the one BookOrbit hardlinked
 * from, so removing it is a real choice rather than tidying up.
 */
export interface RemoveBookRequestDownloadPayload {
  deleteFiles?: boolean;
}

export interface GrabBookRequestPayload {
  /**
   * Exactly one of: a picked release (`indexerId` plus `releaseGuid`), a magnet, or a .torrent.
   *
   * A picked release is named, never linked: the server resolves the download URL from its own
   * search results, so a client cannot point the download client at an address it chose.
   */
  indexerId?: number;
  releaseGuid?: string;
  magnet?: string;
  torrentFileBase64?: string;
  torrentFileName?: string;
  downloadClientId?: number;
}

/**
 * Why a grab could not be started, in terms of how far the refusal reaches. The English `message`
 * says what happened; this says what a second attempt should do about it, which is the part a
 * failover and the picker both have to act on without reading tracker prose.
 */
export const GRAB_FAILURE_CODES = [
  /** The source refused this account outright, so every other release it holds is refused too. */
  "GRAB_SOURCE_REFUSED",
  /** The source refused a VIP-only release. Its ordinary releases are still grabbable. */
  "GRAB_VIP_REQUIRED",
  /** The source did not answer. Nothing else from it is worth trying in the same breath. */
  "GRAB_SOURCE_UNAVAILABLE",
  /** The download client would not take it, so nothing needing that client will start either. */
  "GRAB_CLIENT_REFUSED",
  /** This release alone: gone from the results, unimportable, or already downloading. */
  "GRAB_RELEASE_REFUSED",
] as const;
export type GrabFailureCode = (typeof GRAB_FAILURE_CODES)[number];

/**
 * Whether the refusal is a property of the source rather than of the one release. Both the
 * failover and the picker skip the rest of a source's releases on these, and only these.
 */
export const SOURCE_WIDE_GRAB_FAILURE_CODES: readonly GrabFailureCode[] = ["GRAB_SOURCE_REFUSED", "GRAB_SOURCE_UNAVAILABLE"];

/** One release that was handed over and refused, kept for what it rules out about the others. */
export interface GrabRefusal {
  /** Null for a hand-pasted magnet or .torrent, which came from no source in the list. */
  indexerId: number | null;
  code: GrabFailureCode;
}

/**
 * The earlier refusal that already answers for this release, if one does, so nothing is handed
 * over to be told the same thing twice.
 *
 * Shared because the failover and the picker have to agree about the same list on the same
 * screen: the automation stops trying what this rules out, and the picker stops offering it.
 * `seedsBack` is what makes a release depend on a download client, which is why a client refusing
 * one torrent says nothing about a source BookOrbit downloads from itself.
 */
export function findGrabRefusal(
  release: { indexerId: number; vipOnly: boolean; seedsBack: boolean },
  refusals: readonly GrabRefusal[],
): GrabRefusal | null {
  return (
    refusals.find((refusal) => {
      if (refusal.code === "GRAB_CLIENT_REFUSED") return release.seedsBack;
      if (refusal.indexerId !== release.indexerId) return false;
      if (refusal.code === "GRAB_VIP_REQUIRED") return release.vipOnly;
      return SOURCE_WIDE_GRAB_FAILURE_CODES.includes(refusal.code);
    }) ?? null
  );
}

/** Pushed over the request gateway so a card can move without polling. */
export interface BookRequestProgressEvent {
  requestId: number;
  downloadId: number;
  status: BookRequestDownloadStatus;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number | null;
}
