import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DownloadClientTestResult } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { safeFetch } from '../../../../common/utils/safe-fetch';
import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import type {
  DownloadClientAdapter,
  DownloadStatus,
  GrabPayload,
  OwnedDownloadClientInventory,
  SeedInfo,
  StagedDownloadResult,
  ResolvedClientConfig,
} from '../download-client-adapter';
import { stagedClientDir } from '../download-client-adapter';
import { TORBOX_LABEL, TorboxApiClient } from './torbox.api';
import type { TorboxTorrent } from './torbox.api';

const MEBIBYTE = 1024 * 1024;
/**
 * The same per-file ceiling the built-in downloader enforces. A cloud client can hold a release
 * far larger than a book import will ever use, and staging must not be the way that lands.
 */
const MAX_FILE_BYTES = 8 * 1024 * MEBIBYTE;
const MAX_FILE_LABEL = `${MAX_FILE_BYTES / (1024 * MEBIBYTE)} GiB`;
const IDLE_TIMEOUT_MS = 120_000;
const IDLE_CHECK_MS = 5_000;
const MAX_TRANSFER_MS = 12 * 60 * 60 * 1000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'BookOrbit';
/** Cloud-side spellings that mean the torrent has not started moving yet. */
const QUEUED_STATES = new Set(['queued', 'paused', 'metaDL', 'checkingResumeData']);
const HTML_CONTENT_TYPE = /^text\/html\b/i;
const STAGING_CANCELLED_MESSAGE = 'The download was removed while it was being staged';

interface StagingJob {
  downloadedBytes: number;
  totalBytes: number;
  cancelled: boolean;
  cancelWatchers: Set<() => void>;
}

/**
 * TorBox holds the downloads; BookOrbit cannot open them where they are. The adapter therefore
 * implements `stage()`: once TorBox reports a torrent finished, the monitor asks for it to be
 * fetched file by file into `client-downloads/torbox/<infohash>`, and only then reports the local
 * path that the import pipeline knows how to read.
 */
@Injectable()
export class TorboxAdapter implements DownloadClientAdapter {
  readonly type = 'torbox' as const;
  readonly label = TORBOX_LABEL;
  readonly delivers = 'torrent' as const;

  private readonly logger = new Logger(TorboxAdapter.name);
  private readonly appDataPath: string;
  /** Per client row and infohash, what is currently being fetched and how far it has come. */
  private readonly staging = new Map<number, Map<string, StagingJob>>();

  constructor(
    private readonly api: TorboxApiClient,
    config: ConfigService,
  ) {
    this.appDataPath = config.getOrThrow<string>('storage.appDataPath');
  }

  async add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientKey: string }> {
    const clientKey = normalizeKey(release.clientKey);
    if (!config.password?.trim()) throw new BadRequestException('TorBox needs an API key');

    // A re-grab of something the account already holds adopts the existing item: adding it again
    // would put a second copy of the same infohash in the account.
    const existing = await this.api.findByHashes(config, new Set([clientKey]));
    if (existing.has(clientKey)) return { clientKey };

    if (!release.magnet && !release.torrentFile) {
      throw new BadRequestException('A grab needs either a magnet link or a .torrent file');
    }

    const created = await this.api.createTorrent(config, {
      magnet: release.magnet,
      torrentFile: release.torrentFile,
      torrentFileName: release.torrentFileName,
    });
    if (created.hash !== null && created.hash !== clientKey) {
      this.logger.warn(
        `[download_client.add] [end] clientId=${config.id} clientKey=${clientKey} reportedHash=${created.hash} - TorBox reported a different hash; tracking by the release's own key`,
      );
    }

    return { clientKey };
  }

  async status(clientKeys: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]> {
    if (clientKeys.length === 0) return [];
    const wanted = new Set(clientKeys.map(normalizeKey));
    const torrents = await this.api.findByHashes(config, wanted);

    const results: DownloadStatus[] = [];
    for (const clientKey of wanted) {
      const torrent = torrents.get(clientKey);
      if (!torrent) continue;
      results.push(await this.toStatus(clientKey, torrent, config.id));
    }
    return results;
  }

  listOwned(): Promise<OwnedDownloadClientInventory> {
    // There is no ownership marker to filter by: this account belongs to the operator, and the
    // other torrents in it are none of BookOrbit's business.
    return Promise.resolve({ supported: false, truncated: false, items: [] });
  }

  async remove(clientKey: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void> {
    const key = normalizeKey(clientKey);
    this.cancelStaging(config.id, key);

    const found = await this.api.findByHashes(config, new Set([key]));
    const torrent = found.get(key);
    // Deleting is permanent on TorBox's side; that is the API's design, and a no-op if the item is
    // already gone, so the local cleanup below is what the operator's choice actually controls.
    if (torrent) await this.api.controlTorrent(config, torrent.torrentId, 'delete');

    if (opts.deleteFiles) {
      await rm(stagedClientDir(this.appDataPath, this.type, key), { recursive: true, force: true });
    }
  }

  async test(config: ResolvedClientConfig): Promise<DownloadClientTestResult> {
    const startedAt = Date.now();
    try {
      const user = await this.api.getUser(config);
      return { success: true, version: user.email ?? 'TorBox' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.test] [fail] clientId=${config.id} durationMs=${Date.now() - startedAt} errorClass=${
          error instanceof Error ? error.constructor.name : 'Error'
        } error="${sanitizeLogValue(message)}" - TorBox connection test failed`,
      );
      return { success: false, error: message };
    }
  }

  async stage(clientKey: string, config: ResolvedClientConfig): Promise<StagedDownloadResult> {
    const key = normalizeKey(clientKey);
    const directory = stagedClientDir(this.appDataPath, this.type, key);
    // Registered before the first await so a remove that lands during setup still finds this job
    // instead of slipping past cancelStaging and letting the fetch run over the removed attempt.
    const job: StagingJob = { downloadedBytes: 0, totalBytes: 0, cancelled: false, cancelWatchers: new Set() };
    this.stagingFor(config.id).set(key, job);
    const startedAt = Date.now();
    let partial: string | null = null;

    try {
      const found = await this.api.findByHashes(config, new Set([key]));
      this.ensureNotCancelled(job);

      const torrent = found.get(key);
      if (!torrent) throw new BadRequestException('TorBox no longer has this download');
      if (!torrent.downloadFinished) throw new BadRequestException('TorBox has not finished this download');
      if (torrent.files.length === 0) throw new BadRequestException('TorBox did not report which files this download holds');
      job.totalBytes = torrent.totalBytes ?? 0;

      await mkdir(directory, { recursive: true });
      this.ensureNotCancelled(job);

      this.logger.log(
        `[download_client.stage] [start] clientId=${config.id} clientKey=${key} files=${torrent.files.length} - staging a cloud download`,
      );
      const targets = uniqueTargetsFor(directory, torrent.files);
      for (let index = 0; index < torrent.files.length; index += 1) {
        this.ensureNotCancelled(job);
        const file = torrent.files[index];
        const target = targets[index];
        // Idempotent by file: a restart re-runs this and skips everything already fetched whole.
        const existing = await completeFileSize(target, file.size);
        if (existing !== null) {
          job.downloadedBytes += existing;
          continue;
        }

        if (file.fileId === null) throw new BadRequestException('TorBox did not report an id for a file in this download');
        const part = `${target}.part`;
        await mkdir(dirname(target), { recursive: true });
        await rm(part, { force: true });
        const link = await this.api.requestDownloadLink(config, torrent.torrentId, file.fileId);
        this.ensureNotCancelled(job);
        partial = part;
        await this.downloadToFile(link, part, file.size, job);
        await rename(part, target);
        partial = null;
      }
    } catch (error) {
      // A failed fetch leaves nothing useful behind: the next attempt starts this file over.
      if (partial !== null) await rm(partial, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.stage] [fail] clientId=${config.id} clientKey=${key} durationMs=${Date.now() - startedAt} errorClass=${
          error instanceof Error ? error.constructor.name : 'Error'
        } error="${sanitizeLogValue(message)}" - cloud download staging failed`,
      );
      throw error;
    } finally {
      this.stagingFor(config.id).delete(key);
    }

    this.logger.log(
      `[download_client.stage] [end] clientId=${config.id} clientKey=${key} durationMs=${Date.now() - startedAt} bytes=${job.downloadedBytes} - cloud download staged`,
    );
    return { contentPath: directory };
  }

  private async toStatus(clientKey: string, torrent: TorboxTorrent, clientId: number): Promise<DownloadStatus> {
    const base = {
      clientKey,
      progressPercent: torrent.progressPercent,
      downloadedBytes: torrent.downloadedBytes,
      totalBytes: torrent.totalBytes,
      contentPath: null,
    };

    if (torrent.downloadPresent === false) {
      return { ...base, state: 'failed', errorMessage: 'TorBox no longer holds the files for this download' };
    }
    if (torrent.state === 'error') {
      return { ...base, state: 'failed', errorMessage: 'TorBox reported an error for this download' };
    }

    if (torrent.downloadFinished) {
      const job = this.staging.get(clientId)?.get(clientKey);
      if (job) {
        // Still fetching: report progress so the wall clock keeps moving for the stall watchdog.
        return {
          ...base,
          state: 'downloading',
          progressPercent: percentOf(job.downloadedBytes, job.totalBytes),
          downloadedBytes: job.downloadedBytes,
          totalBytes: job.totalBytes > 0 ? job.totalBytes : torrent.totalBytes,
        };
      }
      if (torrent.files.length === 0) {
        return { ...base, state: 'failed', errorMessage: 'TorBox reported the download as finished but did not report which files it holds' };
      }

      const staged = await this.stagedPathIfComplete(clientKey, torrent);
      return {
        ...base,
        state: 'completed',
        progressPercent: 100,
        downloadedBytes: torrent.totalBytes ?? torrent.downloadedBytes,
        contentPath: staged,
        seed: toSeedInfo(torrent),
      };
    }

    return { ...base, state: QUEUED_STATES.has(torrent.state ?? '') ? 'queued' : 'downloading' };
  }

  /**
   * The local directory, once every file the account lists is on disk at its listed size. Null
   * means "not staged yet, or not whole", which is what sends the monitor off to stage it.
   */
  private async stagedPathIfComplete(clientKey: string, torrent: TorboxTorrent): Promise<string | null> {
    const directory = stagedClientDir(this.appDataPath, this.type, clientKey);
    let targets: string[];
    try {
      targets = uniqueTargetsFor(directory, torrent.files);
    } catch {
      return null;
    }
    for (let index = 0; index < torrent.files.length; index += 1) {
      if ((await completeFileSize(targets[index], torrent.files[index].size)) === null) return null;
    }
    return directory;
  }

  private async downloadToFile(url: string, target: string, expectedBytes: number | null, job: StagingJob): Promise<void> {
    const cancelled = new AbortController();
    const onCancel = () => cancelled.abort(new Error(STAGING_CANCELLED_MESSAGE));
    job.cancelWatchers.add(onCancel);

    const stalled = new AbortController();
    const stallMessage = `TorBox stopped sending data for more than ${Math.round(IDLE_TIMEOUT_MS / 1000)} seconds`;
    let lastChunkAt = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastChunkAt > IDLE_TIMEOUT_MS) stalled.abort(new Error(stallMessage));
    }, IDLE_CHECK_MS);
    watchdog.unref?.();

    const ceiling = AbortSignal.timeout(MAX_TRANSFER_MS);
    const transfer = AbortSignal.any([cancelled.signal, stalled.signal, ceiling]);
    let written = 0;

    try {
      const response = await this.open(url, transfer);
      const contentType = response.headers.get('content-type') ?? '';
      if (HTML_CONTENT_TYPE.test(contentType)) throw new BadRequestException('TorBox answered with a web page rather than a file');

      const declared = response.headers.get('content-length');
      const declaredBytes = declared === null ? null : Number(declared);
      if (declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes > MAX_FILE_BYTES) {
        throw new BadRequestException(`A file in this release is larger than the ${MAX_FILE_LABEL} BookOrbit will fetch`);
      }
      if (!response.body) throw new BadRequestException('TorBox answered without a file body');

      const reader = response.body.getReader();
      const abortReader = () => {
        void reader.cancel().catch(() => undefined);
      };
      transfer.addEventListener('abort', abortReader, { once: true });

      const counted = async function* (): AsyncGenerator<Uint8Array> {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (!value) continue;
          lastChunkAt = Date.now();
          written += value.byteLength;
          if (written > MAX_FILE_BYTES) {
            throw new BadRequestException(`A file in this release is larger than the ${MAX_FILE_LABEL} BookOrbit will fetch`);
          }
          job.downloadedBytes += value.byteLength;
          yield value;
        }
      };

      try {
        await pipeline(Readable.from(counted()), createWriteStream(target), { signal: transfer });
      } finally {
        transfer.removeEventListener('abort', abortReader);
        try {
          reader.releaseLock();
        } catch {
          // The reader was already cancelled by the abort that ended this transfer.
        }
      }
    } catch (error) {
      if (stalled.signal.aborted) throw new Error(stallMessage, { cause: error });
      if (ceiling.aborted) throw new Error('Staging this download took longer than twelve hours', { cause: error });
      throw error;
    } finally {
      clearInterval(watchdog);
      job.cancelWatchers.delete(onCancel);
    }

    if (expectedBytes !== null && written !== expectedBytes) {
      throw new Error(`TorBox served ${written} bytes where it listed ${expectedBytes}`);
    }
  }

  /** Follows the CDN link by hand so every hop is checked the way every other fetch in BookOrbit is. */
  private async open(rawUrl: string, signal: AbortSignal): Promise<Response> {
    let current = await ensureSafeUrl(rawUrl, { allowPrivate: false });

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await safeFetch(
        current.href,
        { redirect: 'manual', signal, headers: { Accept: '*/*', 'User-Agent': USER_AGENT } },
        { allowPrivate: false, profile: null, pinResolvedAddress: true },
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (response.body) await response.body.cancel().catch(() => undefined);
        if (!location) throw new Error('The TorBox download link redirected without a location');
        current = await ensureSafeUrl(new URL(location, current).href, { allowPrivate: false });
        continue;
      }

      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => undefined);
        throw new Error(`The TorBox download link answered ${response.status}`);
      }

      return response;
    }

    throw new Error('The TorBox download link redirected too many times');
  }

  private cancelStaging(clientId: number, clientKey: string): void {
    const jobs = this.staging.get(clientId);
    const job = jobs?.get(clientKey);
    if (!job) return;
    // The flag also covers a cancel that lands before the job has registered a watcher for the
    // transfer it is about to start.
    job.cancelled = true;
    jobs?.delete(clientKey);
    for (const watcher of job.cancelWatchers) watcher();
  }

  private ensureNotCancelled(job: StagingJob): void {
    if (job.cancelled) throw new Error(STAGING_CANCELLED_MESSAGE);
  }

  private stagingFor(clientId: number): Map<string, StagingJob> {
    const existing = this.staging.get(clientId);
    if (existing) return existing;
    const created = new Map<string, StagingJob>();
    this.staging.set(clientId, created);
    return created;
  }
}

function normalizeKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(key)) throw new BadRequestException('Invalid client key');
  return key;
}

/**
 * The targets for a release's files, with later files whose sanitized name collides getting a
 * numbered suffix. Deterministic for a given file order, so a re-run and the staged check agree.
 */
function uniqueTargetsFor(directory: string, files: ReadonlyArray<{ name: string }>): string[] {
  const claimed = new Set<string>();
  return files.map((file) => {
    const base = stagedTargetFor(directory, file.name);
    let target = base;
    let counter = 1;
    while (claimed.has(target)) {
      target = suffixedTarget(base, counter);
      counter += 1;
    }
    claimed.add(target);
    return target;
  });
}

/** The suffix keeps the extension, so an import still recognises the file as a book. */
function suffixedTarget(target: string, counter: number): string {
  const extension = extname(target);
  if (extension === '') return `${target} (${counter})`;
  return `${target.slice(0, -extension.length)} (${counter})${extension}`;
}

/**
 * A release names its files, and a hostile or broken torrent can name one that climbs out of the
 * staging directory. Segments are reduced to plain names before they are joined, so the result is
 * inside the directory by construction; the prefix check is the belt to that suspenders.
 */
function stagedTargetFor(directory: string, name: string): string {
  const segments = name
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  const target = resolve(directory, ...(segments.length > 0 ? segments : ['release.bin']));
  if (target !== directory && !target.startsWith(directory + sep)) {
    throw new BadRequestException('TorBox named a file that would land outside the staging directory');
  }
  return target;
}

/** The file's size when it is present and whole at the listed size, null otherwise. */
async function completeFileSize(target: string, expected: number | null): Promise<number | null> {
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
    if (expected !== null && info.size !== expected) return null;
    return info.size;
  } catch {
    return null;
  }
}

function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function toSeedInfo(torrent: TorboxTorrent): SeedInfo {
  return {
    // TorBox seeds on its own side, and reports whether the item is active rather than a goal.
    seeding: torrent.state === 'uploading' || torrent.active,
    ratio: torrent.ratio,
    ratioGoal: null,
    seedingTimeSeconds: null,
    seedingTimeGoalMinutes: null,
    uploadedBytes: null,
  };
}
