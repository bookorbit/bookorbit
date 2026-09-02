import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { BOOK_FORMATS } from '@bookorbit/types';

import { storageConfig } from '../../../config/config';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { safeFetch } from '../../../common/utils/safe-fetch';
import { ensureSafeUrl } from '../../../common/utils/ssrf.utils';
import type { BookRequestDownloadRow } from '../../../db/schema';
import type { DownloadStatus } from '../download-clients/download-client-adapter';
import { BookRequestDownloadRepository } from './book-request-download.repository';

/**
 * Where BookOrbit's own fetches land, and therefore the boundary the import may read one out of.
 * A direct file has no download client and so no path mapping to declare a root for it; this is
 * that root, and the importer holds it to the same containment a mapped client path gets.
 */
export function directDownloadRoot(appDataPath: string): string {
  return join(appDataPath, 'request-downloads');
}

/** The formats a staged name may be given, which is exactly what the importer classifies by. */
const STAGEABLE_FORMATS = new Set<string>(BOOK_FORMATS);

/**
 * The name a resolved file is staged under, which has to be a name the importer can classify.
 *
 * A direct source states its format out of band and its download URL often ends in something that
 * is not a filename at all, so `{ fileName: "download", format: "epub" }` is an ordinary answer.
 * Staged unchanged it is a file the importer finds no book in, and the release is then accepted,
 * downloaded in full, and only afterwards refused for a condition inspection called safe.
 *
 * Carrying the declared extension closes that gap, and the rule is deliberately narrow: a name
 * that already carries any extension is left alone, because a `.zip` holding an epub is an
 * archive the importer extracts and `book.zip.epub` is one it cannot open at all.
 */
export function stagedDirectFileName(fileName: string | null | undefined, format: string | null | undefined): string {
  const name = (fileName ?? '').trim();
  const declared = (format ?? '').trim().toLowerCase().replace(/^\./, '');
  const stageable = STAGEABLE_FORMATS.has(declared);

  if (!name) return stageable ? `download.${declared}` : 'download.bin';
  if (extname(name) !== '') return name;
  return stageable ? `${name}.${declared}` : name;
}

/** Generous enough for an unabridged audiobook, low enough that a runaway response is bounded. */
const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 30_000;
/**
 * A stalled body, as distinct from a slow one: how long a transfer may send nothing at all before
 * it is treated as dead rather than slow. Reset whenever bytes actually arrive.
 */
const IDLE_TIMEOUT_MS = 120_000;
/** How often that is checked. Coarse on purpose: it is a watchdog, not a stopwatch. */
const IDLE_CHECK_MS = 5_000;
/**
 * A backstop so a trickle cannot hold a download slot open forever, not a throughput expectation.
 * Generous enough that no honest transfer reaches it: even the 8 GB cap only needs 190 KB/s.
 */
const MAX_TRANSFER_MS = 12 * 60 * 60 * 1000;
const MAX_REDIRECTS = 5;

/**
 * How long a finished transfer stays readable before its entry is dropped.
 *
 * The poll loop reads a direct transfer once a second and stops reading it the moment it records
 * a terminal state, so this is several thousand times longer than the outcome needs to survive.
 * It is generous because the alternative to a stale entry is an outcome nobody ever saw: an
 * attempt whose `failed` is dropped too early reads as `unknown` instead, and the reason it
 * failed is replaced by "the download client no longer has this torrent".
 */
const TERMINAL_RETENTION_MS = 10 * 60 * 1000;

/** An open library answers a wrong path with a courtesy HTML page and a 200, not a 404. */
const HTML_CONTENT_TYPE = /^text\/html\b/i;

/**
 * Sent because Node's fetch otherwise announces itself as `node`, which file hosts commonly refuse.
 *
 * Measured 2026-08-20 against a Library Genesis CDN: the same link answered `application/octet-stream`
 * for this string, for no agent header at all, and for a browser one, and answered `text/html` for
 * `node`, `curl` and `python-requests`. So what is being refused is a known automation token rather
 * than anything a real client sends, and saying who we actually are is enough to be served.
 */
const USER_AGENT = 'BookOrbit';

/**
 * A release URL comes from an indexer, which is the one thing on this path that is never trusted,
 * so a direct fetch never reaches the private network. Torrent clients get a per-row opt-in
 * because they live on the LAN; there is no equivalent reason for a file to.
 */
const ALLOW_PRIVATE = false;

interface Progress {
  state: DownloadStatus['state'];
  downloadedBytes: number;
  totalBytes: number | null;
  contentPath: string | null;
  errorMessage?: string;
  /** When this stopped moving for good, which is what makes the entry collectable. */
  terminalAt?: number;
}

export interface DirectDownloadRequest {
  downloadId: number;
  fileUrl: string;
  fileName?: string;
  /** What the source declared the file to be, which is what names a file that arrived without one. */
  format?: string | null;
  /**
   * How the poll loop identifies this transfer. A direct file has no infohash, so the caller
   * derives a stable digest of the URL, which keeps the duplicate-grab index meaningful.
   */
  infoHash: string;
}

/**
 * Fetches one file over plain HTTP into a staging directory, and reports on it the way a torrent
 * client reports on a torrent, so the import path downstream is unchanged: it still reads a
 * `contentPath` and still hardlinks out of it into the Book Dock.
 *
 * This exists because the good public-domain sources are not torrents. Standard Ebooks and
 * Project Gutenberg publish no torrents at all, and an Internet Archive item torrent is mostly
 * not the book: the Frankenstein item measured on 2026-08-19 is 134 MB across 13 files for a
 * 13.8 MB PDF, where the direct file is a 382 KB EPUB. It also means book requests work on a
 * fresh install with no torrent client configured, which is otherwise the first hard step.
 *
 * Deliberately not a `DownloadClientAdapter`: there is no address, no credentials and nothing to
 * choose, so an operator is never asked to configure it and no row stands for it. Attempts it
 * fetched are the ones whose `source` is `direct_url`.
 *
 * Active progress lives in memory, while the source URL, target name, byte count and HTTP
 * validators live on the attempt row. On restart a partial file is resumed only when `If-Range`
 * and an exact `Content-Range` prove the response continues the same representation.
 */
@Injectable()
export class DirectDownloadService {
  private readonly logger = new Logger(DirectDownloadService.name);

  private readonly progress = new Map<string, Progress>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Map<string, Promise<void>>();

  constructor(
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
    private readonly downloads: BookRequestDownloadRepository,
  ) {}

  private get root(): string {
    return directDownloadRoot(this.storage.appDataPath);
  }

  async add(release: DirectDownloadRequest): Promise<{ clientHash: string }> {
    const url = await ensureSafeUrl(release.fileUrl, { allowPrivate: ALLOW_PRIVATE });

    const directory = join(this.root, release.infoHash);
    const target = safeJoin(directory, stagedDirectFileName(release.fileName, release.format));

    await mkdir(directory, { recursive: true });
    this.start(release.downloadId, release.infoHash, url, target, directory, 0, null, null);

    return { clientHash: release.infoHash };
  }

  /** Restores one active direct attempt left by the previous process. */
  async resume(download: BookRequestDownloadRow): Promise<boolean> {
    if (
      download.source !== 'direct_url' ||
      download.clientHash === null ||
      download.directUrl === null ||
      download.directFileName === null ||
      this.progress.has(download.clientHash)
    ) {
      return false;
    }

    const url = await ensureSafeUrl(download.directUrl, { allowPrivate: ALLOW_PRIVATE });
    const directory = join(this.root, download.clientHash);
    const target = safeJoin(directory, download.directFileName);
    const existingBytes = await stat(target)
      .then((entry) => (entry.isFile() ? entry.size : 0))
      .catch(() => 0);
    const validator = resumeValidator(download.directEtag, download.directLastModified);
    if (existingBytes > 0 && validator === null) return false;
    if (existingBytes > MAX_FILE_BYTES) return false;

    await mkdir(directory, { recursive: true });
    this.start(download.id, download.clientHash, url, target, directory, existingBytes, validator, download.totalBytes);
    this.logger.log(
      `[direct_download.resume] [start] downloadId=${download.id} hash=${download.clientHash} bytes=${existingBytes} - resuming an interrupted direct download`,
    );
    return true;
  }

  private start(
    downloadId: number,
    infoHash: string,
    url: URL,
    target: string,
    directory: string,
    offset: number,
    validator: string | null,
    expectedBytes: number | null,
  ): void {
    this.progress.set(infoHash, {
      state: 'downloading',
      downloadedBytes: offset,
      totalBytes: expectedBytes,
      contentPath: null,
    });
    const controller = new AbortController();
    this.controllers.set(infoHash, controller);

    // Deliberately not awaited: `add` hands the work over the way a torrent client does, and the
    // poll loop is what reports on it from here.
    const task = this.run(downloadId, infoHash, url, target, controller.signal, offset, validator, expectedBytes)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        const current = this.progress.get(infoHash);
        this.progress.set(infoHash, {
          state: 'failed',
          downloadedBytes: current?.downloadedBytes ?? offset,
          totalBytes: current?.totalBytes ?? expectedBytes,
          contentPath: null,
          errorMessage: message,
          terminalAt: Date.now(),
        });
        this.logger.warn(`[direct_download.fetch] [fail] hash=${infoHash} error="${sanitizeLogValue(message)}" - direct download failed`);
      })
      .finally(async () => {
        this.controllers.delete(infoHash);
        this.tasks.delete(infoHash);
        if (this.progress.get(infoHash)?.state !== 'completed') await this.discard(infoHash, directory);
      });
    this.tasks.set(infoHash, task);
    void task;
  }

  /**
   * Reports only the transfers this process is actually holding, exactly as a download client
   * reports only the torrents it holds.
   *
   * Nothing in memory means this process never started it or was restarted under it, and progress
   * lives only in memory: there is nothing left to resume. Answering with `unknown` instead used to
   * read to the poll loop as an unmapped state, which it spells `downloading`, so an interrupted
   * transfer sat at "downloading 0%" until the twelve-hour stall timeout - a timeout sized for a
   * seederless torrent that might still finish, not for a transfer that certainly will not.
   * Leaving the hash out puts it on the monitor's missing path, which gives it two minutes to
   * reappear and then fails it with a reason.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- matches the client adapters it is polled alongside.
  async status(hashes: string[]): Promise<DownloadStatus[]> {
    this.pruneTerminal();
    return hashes.flatMap((infoHash) => {
      const current = this.progress.get(infoHash);
      if (!current) return [];
      const percent =
        current.state === 'completed'
          ? 100
          : current.totalBytes && current.totalBytes > 0
            ? Math.min(99, Math.floor((current.downloadedBytes / current.totalBytes) * 100))
            : 0;
      return [
        {
          infoHash,
          state: current.state,
          progressPercent: percent,
          downloadedBytes: current.downloadedBytes,
          totalBytes: current.totalBytes,
          contentPath: current.contentPath,
          ...(current.errorMessage ? { errorMessage: current.errorMessage } : {}),
        },
      ];
    });
  }

  /**
   * There is no swarm to leave, so removing is only ever about the staged copy. The import has
   * already hardlinked what it wanted, and dropping our link does not touch the library's.
   */
  async remove(hash: string, opts: { deleteFiles: boolean }): Promise<void> {
    this.controllers.get(hash)?.abort();
    await this.tasks.get(hash);
    this.progress.delete(hash);
    if (opts.deleteFiles) await rm(join(this.root, hash), { recursive: true, force: true });
  }

  /**
   * Drops staging directories no attempt is behind any more, against the hashes of the attempts
   * that are. Bootstrap first resumes safe partial transfers and fails the rest, then calls this
   * to remove directories whose attempts no longer have work behind them.
   *
   * Safe to call while transfers are running only because anything this process is working on is
   * held in `progress` and skipped; the caller is still expected to be the boot path.
   */
  async reapStaging(liveHashes: ReadonlySet<string>): Promise<number> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);

    let reaped = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || liveHashes.has(entry.name) || this.progress.has(entry.name)) continue;
      await this.discard(entry.name, join(this.root, entry.name));
      reaped++;
    }
    return reaped;
  }

  /**
   * Best-effort: staging that could not be removed is wasted disk, and failing the transfer over
   * it would replace the reason it actually ended with a filesystem error nobody can act on.
   */
  private async discard(hash: string, directory: string): Promise<void> {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[direct_download.discard] [fail] hash=${hash} error="${sanitizeLogValue(message)}" - staged download could not be removed`);
    }
  }

  /**
   * A finished transfer is read once and never again, so its entry is only kept long enough for
   * the poll loop to have seen it. Swept here rather than on a timer because the map is small and
   * this is the one method anything calls often.
   */
  private pruneTerminal(): void {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS;
    for (const [hash, entry] of this.progress) {
      if (entry.terminalAt !== undefined && entry.terminalAt <= cutoff) this.progress.delete(hash);
    }
  }

  private async run(
    downloadId: number,
    infoHash: string,
    url: URL,
    target: string,
    signal: AbortSignal,
    offset: number,
    validator: string | null,
    expectedBytes: number | null,
  ): Promise<void> {
    const response = await this.open(url, signal, offset > 0 ? { Range: `bytes=${offset}-`, 'If-Range': validator as string } : {});
    const responseMeta = validateDownloadResponse(response, offset, expectedBytes, validator);
    const totalBytes = responseMeta.totalBytes;
    if (totalBytes !== null && totalBytes > MAX_FILE_BYTES) {
      throw new Error(`That file is ${totalBytes} bytes, past the ${MAX_FILE_BYTES} byte limit`);
    }

    if (responseMeta.alreadyComplete) {
      await response.body?.cancel().catch(() => {});
      this.progress.set(infoHash, {
        state: 'completed',
        downloadedBytes: offset,
        totalBytes: offset,
        contentPath: target,
        terminalAt: Date.now(),
      });
      return;
    }

    const etag = strongEtag(response.headers.get('etag'));
    const lastModified = response.headers.get('last-modified')?.trim() || null;
    await this.downloads.update(downloadId, {
      directEtag: etag ?? strongEtag(validator),
      directLastModified: lastModified ?? (validator && strongEtag(validator) === null ? validator : null),
      totalBytes,
    });

    // Filename alone says nothing about what a server actually sent, and a courtesy error page
    // saved as book.epub would go on to fail somewhere much less obvious.
    const contentType = response.headers.get('content-type') ?? '';
    if (HTML_CONTENT_TYPE.test(contentType)) throw new Error('That URL answered with a web page rather than a file');
    if (!response.body) throw new Error('That URL answered with an empty body');

    let downloaded = offset;
    let lastChunkAt = Date.now();
    const body = response.body;
    const reader = body.getReader();

    /**
     * Idle rather than total. A budget that scaled with the file size still assumed a floor on
     * throughput - the previous one worked out at about 1 MB/s, so a 239 MB audiobook needed
     * 5.4 Mbit/s - and it spent six minutes downloading before deciding the line was too slow.
     * A slow transfer is not a failed one. What tells the two apart is whether bytes are still
     * arriving, so that is what is measured, and the size of the file stops mattering.
     */
    const stalled = new AbortController();
    const stallMessage = `That download sent nothing for ${IDLE_TIMEOUT_MS}ms`;
    const watchdog = setInterval(() => {
      if (Date.now() - lastChunkAt > IDLE_TIMEOUT_MS) stalled.abort(new Error(stallMessage));
    }, IDLE_CHECK_MS);
    watchdog.unref?.();

    /**
     * One signal for the whole transfer, and the reader is cancelled from it rather than from the
     * caller's alone. A stalled read is exactly the case where nothing else can end it: the
     * generator sits inside `reader.read()` waiting for bytes that never come, so aborting the
     * pipeline cannot tear it down and the download hangs instead of failing.
     */
    const ceiling = AbortSignal.timeout(MAX_TRANSFER_MS);
    const transfer = AbortSignal.any([signal, stalled.signal, ceiling]);
    const cancelReader = () => {
      void reader.cancel(transfer.reason).catch(() => {});
    };
    transfer.addEventListener('abort', cancelReader, { once: true });
    const onProgress = (bytes: number) => {
      const current = this.progress.get(infoHash);
      if (current) this.progress.set(infoHash, { ...current, downloadedBytes: bytes, totalBytes });
    };

    // Counted as it streams rather than buffered: an audiobook is gigabytes, and the point of
    // the cap is that we stop at it rather than discovering it after holding the whole file.
    const counted = async function* () {
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) return;
          downloaded += chunk.byteLength;
          lastChunkAt = Date.now();
          if (downloaded > MAX_FILE_BYTES) throw new Error(`That file went past the ${MAX_FILE_BYTES} byte limit while downloading`);
          onProgress(downloaded);
          yield chunk;
        }
      } finally {
        transfer.removeEventListener('abort', cancelReader);
        reader.releaseLock();
      }
    };

    try {
      await pipeline(Readable.from(counted()), createWriteStream(target, { flags: offset > 0 ? 'a' : 'w' }), { signal: transfer });
    } catch (error) {
      // `pipeline` rejects with a bare "The operation was aborted" rather than the reason it was
      // given, which is what put that sentence in the operator's log in place of the cause.
      if (stalled.signal.aborted) throw new Error(stallMessage, { cause: error });
      if (ceiling.aborted) throw new Error(`That download was still running after ${MAX_TRANSFER_MS}ms`, { cause: error });
      throw error;
    } finally {
      clearInterval(watchdog);
    }

    if (downloaded === offset) throw new Error('That URL answered with an empty file');
    if (totalBytes !== null && downloaded !== totalBytes) {
      throw new Error(`That source ended after ${downloaded} of ${totalBytes} bytes`);
    }
    this.progress.set(infoHash, {
      state: 'completed',
      downloadedBytes: downloaded,
      totalBytes: totalBytes ?? downloaded,
      contentPath: target,
      terminalAt: Date.now(),
    });
    this.logger.log(`[direct_download.fetch] [end] hash=${infoHash} bytes=${downloaded} - direct download finished`);
  }

  /**
   * Redirects are followed by hand so every hop is checked: `redirect: 'follow'` would let a
   * first-hop redirect to a private address through, which is the whole point of the check.
   *
   * Every hop that is not the one being returned has its body cancelled. A redirect usually
   * carries a short courtesy page, but nothing obliges it to, and an undrained body holds its
   * socket open until the agent times it out: five hops through a chain of mirrors would otherwise
   * leave five sockets and five buffers behind per grab.
   */
  private async open(url: URL, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.openHop(current, signal, headers);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) throw new Error(`That URL answered ${response.status} without saying where to go`);
        current = await ensureSafeUrl(new URL(location, current).href, { allowPrivate: ALLOW_PRIVATE });

        continue;
      }

      if (!response.ok && response.status !== 416) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`That URL answered ${response.status}`);
      }
      return response;
    }
    throw new Error(`That URL redirected more than ${MAX_REDIRECTS} times`);
  }

  /**
   * One hop, with a deadline that covers reaching the server and getting its headers back and is
   * dropped the moment they arrive.
   *
   * `AbortSignal.timeout` cannot express that. The signal it returns stays attached to the
   * response body, so a connect deadline set here goes on to abort a download that is streaming
   * perfectly well: a 239 MB LibriVox zip arrives at about 6 MB/s and needs 39 seconds, and every
   * one of them died at exactly 30 with three quarters of the file already written. Gutenberg's
   * one-megabyte EPUBs finish long before the deadline, which is why it took an audiobook to show.
   *
   * The body is not left unbounded: `run` holds it to an idle timeout and a total ceiling.
   */
  private async openHop(url: URL, signal: AbortSignal, headers: Record<string, string>): Promise<Response> {
    const connect = new AbortController();
    const deadline = setTimeout(() => connect.abort(new Error(`That URL did not answer within ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
    try {
      return await safeFetch(
        url.href,
        {
          redirect: 'manual',
          signal: AbortSignal.any([signal, connect.signal]),
          headers: { Accept: '*/*', 'User-Agent': USER_AGENT, ...headers },
        },
        // Pinned, because the URL came from an indexer or a plugin rather than from an operator:
        // this is exactly the caller the resolve-twice window in `safeFetch` is not acceptable
        // for, so the address that passed policy is the address the socket opens to.
        { allowPrivate: ALLOW_PRIVATE, profile: null, pinResolvedAddress: true },
      );
    } finally {
      clearTimeout(deadline);
    }
  }
}

interface ValidatedDownloadResponse {
  totalBytes: number | null;
  alreadyComplete: boolean;
}

function validateDownloadResponse(
  response: Response,
  offset: number,
  expectedBytes: number | null,
  validator: string | null,
): ValidatedDownloadResponse {
  if (offset === 0) {
    if (response.status !== 200) throw new Error(`That URL answered ${response.status} to a new download`);
    const declared = Number(response.headers.get('content-length'));
    return { totalBytes: Number.isFinite(declared) && declared > 0 ? declared : null, alreadyComplete: false };
  }

  if (!validator) throw new Error('That partial download has no HTTP validator and cannot be resumed safely');

  if (response.status === 416) {
    const total = parseUnsatisfiedRange(response.headers.get('content-range'));
    if (total !== offset || (expectedBytes !== null && expectedBytes !== total)) {
      throw new Error('That source no longer agrees with the saved partial download');
    }
    return { totalBytes: total, alreadyComplete: true };
  }

  if (response.status !== 206) {
    throw new Error('That source does not support resuming this partial download safely');
  }

  const range = parseContentRange(response.headers.get('content-range'));
  if (range.start !== offset || range.end < range.start) {
    throw new Error('That source resumed from a different byte than BookOrbit requested');
  }
  if (expectedBytes !== null && range.total !== expectedBytes) {
    throw new Error('That source changed size since this download started');
  }
  return { totalBytes: range.total, alreadyComplete: false };
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value?.trim() ?? '');
  if (!match) throw new Error('That source returned an invalid Content-Range while resuming');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || total <= 0 || end >= total) {
    throw new Error('That source returned an invalid Content-Range while resuming');
  }
  return { start, end, total };
}

function parseUnsatisfiedRange(value: string | null): number {
  const match = /^bytes \*\/(\d+)$/.exec(value?.trim() ?? '');
  const total = Number(match?.[1]);
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('That source returned an invalid range response');
  return total;
}

function strongEtag(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized && /^"[\s\S]*"$/.test(normalized) ? normalized : null;
}

function resumeValidator(etag: string | null, lastModified: string | null): string | null {
  return strongEtag(etag) ?? (lastModified?.trim() || null);
}

/**
 * The filename comes from an external source, so it is reduced to a bare name and the result is
 * checked to still sit under the directory we made for it.
 */
function safeJoin(directory: string, fileName: string): string {
  const bare = fileName.replace(/[\\/]/g, '_').replace(/^\.+/, '').trim();
  const target = resolve(directory, bare || 'download.bin');
  if (target !== directory && !target.startsWith(directory + sep)) {
    throw new Error('That release names a file that would land outside the download directory');
  }
  return target;
}
