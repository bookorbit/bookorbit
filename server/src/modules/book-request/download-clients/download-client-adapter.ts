import type { DownloadClientTestResult, DownloadClientType, DownloadDelivery } from '@bookorbit/types';

/** A client row with its credentials already decrypted. Never logged, never returned over HTTP. */
export interface ResolvedClientConfig {
  id: number;
  name: string;
  adapterType: DownloadClientType;
  baseUrl: string;
  username: string | null;
  password: string | null;
  category: string;
  allowPrivateAddress: boolean;
  settings: Record<string, unknown> | null;
}

export interface GrabPayload {
  /** Exactly one delivery payload is set. */
  magnet?: string;
  torrentFile?: Buffer;
  torrentFileName?: string;
  nzbFile?: Buffer;
  nzbFileName?: string;
  /** A source that serves the file itself, resolved by the indexer adapter to one direct URL. */
  fileUrl?: string;
  fileName?: string;
  /**
   * How the client and poll loop identify this download. It is an infohash for a torrent and a
   * stable digest for other deliveries, keeping duplicate-grab protection client-independent.
   */
  clientKey: string;
  /**
   * Passed to the client at add time so the client, not BookOrbit, enforces the seed goal.
   * Unset in phase 2: there is no indexer to take a goal from yet.
   */
  seedRatioGoal?: number;
  seedTimeMinutes?: number;
}

export type DownloadState = 'queued' | 'downloading' | 'completed' | 'failed' | 'unknown';

/**
 * What the client is doing with a torrent it has finished. Read live when an approver asks, not
 * stored: a seed outlives the import by weeks and polling every finished download forever would
 * grow without bound.
 */
export interface SeedInfo {
  /** False once the client has stopped it, whether by reaching a goal, by pause or by error. */
  seeding: boolean;
  ratio: number | null;
  /** The goal the client is enforcing, when it reports one back rather than deferring to global. */
  ratioGoal: number | null;
  seedingTimeSeconds: number | null;
  seedingTimeGoalMinutes: number | null;
  uploadedBytes: number | null;
}

export interface DownloadStatus {
  clientKey: string;
  state: DownloadState;
  /** 0-100. */
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  /** Where the finished content sits, in the client's own filesystem namespace. */
  contentPath: string | null;
  /** Only meaningful once the bytes are down; the poll loop ignores it. */
  seed?: SeedInfo;
  errorMessage?: string;
  /**
   * The tracker's own refusal, where every tracker on a torrent that is getting nowhere reports
   * one. A private tracker rejecting the announce leaves the torrent in a perfectly healthy-looking
   * stalled state, so without this the only symptom is a download that never starts.
   */
  trackerError?: string;
}

export interface OwnedDownloadClientItem extends DownloadStatus {
  name: string;
}

export interface OwnedDownloadClientInventory {
  supported: boolean;
  truncated: boolean;
  items: OwnedDownloadClientItem[];
}

export interface DownloadClientAdapter {
  readonly type: DownloadClientType;
  readonly label: string;
  /** What this client can be handed, which is what decides whether a given grab may go to it. */
  readonly delivers: DownloadDelivery;

  add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientKey: string }>;
  /**
   * Batched deliberately: one poll tick is one HTTP call per client however many downloads are
   * in flight. A key the client no longer knows about is simply absent from the result.
   */
  status(clientKeys: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]>;
  listOwned(config: ResolvedClientConfig): Promise<OwnedDownloadClientInventory>;
  remove(clientKey: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void>;
  test(config: ResolvedClientConfig): Promise<DownloadClientTestResult>;
  /**
   * Drop anything cached against this client id. Called whenever a row's URL or credentials
   * change, so a stale session cannot outlive the config it was opened with.
   */
  forget?(clientId: number): void;
}

export const DOWNLOAD_CLIENT_ADAPTERS = Symbol('DOWNLOAD_CLIENT_ADAPTERS');
