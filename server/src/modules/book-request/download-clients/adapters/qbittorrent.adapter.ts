import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DownloadClientTestResult } from '@bookorbit/types';

import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import type { DownloadClientAdapter, DownloadState, DownloadStatus, GrabPayload, ResolvedClientConfig, SeedInfo } from '../download-client-adapter';
import { endpointUrl, fetchClient, readClientJson, readClientText } from './client-http.utils';

const LABEL = 'qBittorrent';
/** qBittorrent's SID cookie lasts an hour by default; re-login well before it lapses. */
const SESSION_TTL_MS = 30 * 60 * 1000;
/** One `torrents/info` URL has to stay a sane length, so very large fleets poll in chunks. */
const STATUS_BATCH_SIZE = 100;
/**
 * `torrents/trackers` takes one hash at a time, so it is only asked about torrents that already
 * look stuck, and only about this many of them per tick. A queue where everything is stalled is a
 * client-wide problem, and hammering the client with one call per torrent would not diagnose it.
 */
const TRACKER_PROBE_LIMIT = 20;

interface QbTracker {
  url?: string;
  /** 0 disabled, 1 not contacted, 2 working, 3 updating, 4 not working. */
  status?: number;
  msg?: string;
}

interface QbTorrentInfo {
  hash?: string;
  name?: string;
  state?: string;
  progress?: number;
  downloaded?: number;
  size?: number;
  total_size?: number;
  content_path?: string;
  save_path?: string;
  ratio?: number;
  ratio_limit?: number;
  seeding_time?: number;
  seeding_time_limit?: number;
  uploaded?: number;
}

/**
 * qBittorrent reports a state machine, not a boolean. Only the seeding and paused-after-complete
 * states mean the bytes are on disk; `checking*` in particular looks idle but is not finished.
 */
const COMPLETED_STATES = new Set(['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'pausedUP', 'stoppedUP', 'checkingUP']);
/** Finished and still working the swarm. The paused and stopped spellings are finished and idle. */
const SEEDING_STATES = new Set(['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'checkingUP']);
const FAILED_STATES = new Set(['error', 'missingFiles']);
const QUEUED_STATES = new Set(['queuedDL', 'allocating', 'metaDL', 'checkingDL', 'checkingResumeData', 'moving', 'pausedDL', 'stoppedDL']);
/**
 * Not an error state as far as qBittorrent is concerned: a torrent whose tracker refuses the
 * announce sits here indefinitely, looking exactly like one that simply has no peers yet.
 */
const STUCK_STATES = new Set(['stalledDL', 'metaDL']);
/** qBittorrent's own pseudo-trackers, which report their own status and are not tracker failures. */
const PSEUDO_TRACKER = /^\*\*/;

@Injectable()
export class QbittorrentAdapter implements DownloadClientAdapter {
  readonly type = 'qbittorrent' as const;
  readonly label = 'qBittorrent';
  readonly delivers = 'torrent' as const;

  private readonly logger = new Logger(QbittorrentAdapter.name);
  private readonly sessions = new Map<number, { cookie: string; expiresAt: number }>();

  async add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientHash: string }> {
    const form = new FormData();
    if (release.torrentFile) {
      form.append('torrents', new Blob([new Uint8Array(release.torrentFile)]), release.torrentFileName ?? 'upload.torrent');
    } else if (release.magnet) {
      form.append('urls', release.magnet);
    } else {
      throw new BadRequestException('A grab needs either a magnet link or a .torrent file');
    }

    form.append('category', config.category);
    // Torrent-level goals: the client enforces them, BookOrbit never stops a seed itself.
    if (release.seedRatioGoal !== undefined) form.append('ratioLimit', String(release.seedRatioGoal));
    if (release.seedTimeMinutes !== undefined) form.append('seedingTimeLimit', String(release.seedTimeMinutes));

    const response = await this.call(config, '/api/v2/torrents/add', { method: 'POST', body: form });
    const body = (await readClientText(response, LABEL)).trim();
    // "Fails." with a 200 is the one 200 that is not success, and it covers two unrelated cases:
    // a torrent the client already holds, and one it could not read. Only the client can tell them
    // apart, so ask rather than hand the operator both guesses at once.
    if (body.toLowerCase().startsWith('fail')) {
      if (await this.holds(release.infoHash, config)) {
        // An earlier attempt on this release leaves its torrent behind when the import fails, and
        // without this every retry of that release is rejected by the client forever. The torrent
        // we asked for being present is the outcome we wanted, not a failure.
        this.logger.log(
          `[download_client.add] [end] clientId=${config.id} hash=${release.infoHash.toLowerCase()} adopted=true - the client already held this torrent`,
        );
        return { clientHash: release.infoHash.toLowerCase() };
      }
      throw new BadRequestException('qBittorrent could not read that torrent. The file may be corrupt, or the magnet link invalid.');
    }

    return { clientHash: release.infoHash.toLowerCase() };
  }

  /**
   * Whether the client is already holding this exact infohash. Any failure to find out answers
   * "no", so an unreachable client surfaces the add failure rather than a false success.
   */
  private async holds(infoHash: string, config: ResolvedClientConfig): Promise<boolean> {
    const hash = infoHash.toLowerCase();
    try {
      const response = await this.call(config, `/api/v2/torrents/info?hashes=${encodeURIComponent(hash)}`, { method: 'GET' });
      const payload = await readClientJson<unknown>(response, LABEL);
      return Array.isArray(payload) && (payload as QbTorrentInfo[]).some((entry) => entry.hash?.toLowerCase() === hash);
    } catch {
      return false;
    }
  }

  async status(hashes: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]> {
    const wanted = new Set(hashes.map((hash) => hash.toLowerCase()));
    const results: DownloadStatus[] = [];
    const stuck: DownloadStatus[] = [];

    for (let index = 0; index < hashes.length; index += STATUS_BATCH_SIZE) {
      const batch = hashes.slice(index, index + STATUS_BATCH_SIZE).map((hash) => hash.toLowerCase());
      const response = await this.call(config, `/api/v2/torrents/info?hashes=${encodeURIComponent(batch.join('|'))}`, { method: 'GET' });
      const payload = await readClientJson<unknown>(response, LABEL);
      if (!Array.isArray(payload)) continue;

      for (const entry of payload as QbTorrentInfo[]) {
        const hash = entry.hash?.toLowerCase();
        if (!hash || !wanted.has(hash)) continue;
        const status = toDownloadStatus(hash, entry);
        results.push(status);
        // Collected here rather than derived from `status`: which qBittorrent states are worth
        // asking about is this adapter's business, and does not belong in the shared shape.
        if (entry.state !== undefined && STUCK_STATES.has(entry.state) && status.downloadedBytes === 0) stuck.push(status);
      }
    }

    await this.attachTrackerErrors(stuck.slice(0, TRACKER_PROBE_LIMIT), config);
    return results;
  }

  /**
   * Fills in `trackerError` for the torrents that are getting nowhere. qBittorrent reports a
   * rejected announce as `stalledDL`, which maps to a perfectly ordinary in-flight state, so the
   * tracker's own message is the only thing that distinguishes "no peers yet" from "this tracker
   * will never accept us".
   */
  private async attachTrackerErrors(stuck: DownloadStatus[], config: ResolvedClientConfig): Promise<void> {
    for (const status of stuck) {
      try {
        const response = await this.call(config, `/api/v2/torrents/trackers?hash=${encodeURIComponent(status.infoHash)}`, { method: 'GET' });
        const payload = await readClientJson<unknown>(response, LABEL);
        if (!Array.isArray(payload)) continue;
        const message = trackerFailure(payload as QbTracker[]);
        if (message) status.trackerError = message;
      } catch (error) {
        // A client that will not answer this endpoint must not take the whole poll down with it;
        // the torrent keeps its state and the watchdog remains the backstop.
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[download_client.trackers] [fail] clientId=${config.id} hash=${status.infoHash} error="${sanitizeLogValue(detail)}" - could not read tracker status`,
        );
      }
    }
  }

  async remove(hash: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void> {
    const body = new URLSearchParams({ hashes: hash.toLowerCase(), deleteFiles: String(opts.deleteFiles) });
    await this.call(config, '/api/v2/torrents/delete', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  async test(config: ResolvedClientConfig): Promise<DownloadClientTestResult> {
    try {
      const response = await this.call(config, '/api/v2/app/version', { method: 'GET' });
      return { success: true, version: (await readClientText(response, LABEL)).trim() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.test] [fail] clientId=${config.id} error="${sanitizeLogValue(message)}" - qBittorrent connection test failed`,
      );
      return { success: false, error: message };
    }
  }

  /** Drops the cached session so the next call re-authenticates against the current config. */
  forget(clientId: number): void {
    this.sessions.delete(clientId);
  }

  private async call(config: ResolvedClientConfig, path: string, init: RequestInit, retryOnAuthFailure = true): Promise<Response> {
    const cookie = await this.session(config);
    const base = await this.resolveBaseUrl(config);
    const response = await fetchClient(
      endpointUrl(base, path),
      { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie, Referer: base.origin } },
      LABEL,
    );

    // An expired SID answers 403 on every endpoint, and looks identical to a permission problem.
    if (response.status === 403 && retryOnAuthFailure) {
      this.sessions.delete(config.id);
      return this.call(config, path, init, false);
    }
    if (!response.ok) {
      throw new BadRequestException(`qBittorrent answered ${response.status} for ${path.split('?')[0]}`);
    }
    return response;
  }

  private async session(config: ResolvedClientConfig): Promise<string> {
    const cached = this.sessions.get(config.id);
    if (cached && cached.expiresAt > Date.now()) return cached.cookie;

    const base = await this.resolveBaseUrl(config);
    const body = new URLSearchParams({ username: config.username ?? '', password: config.password ?? '' });
    const response = await fetchClient(
      endpointUrl(base, '/api/v2/auth/login'),
      { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base.origin } },
      LABEL,
    );

    if (!response.ok) throw new BadRequestException(`qBittorrent refused the login with ${response.status}`);
    const text = (await readClientText(response, LABEL)).trim();
    if (text.toLowerCase().startsWith('fail')) throw new BadRequestException('qBittorrent rejected those credentials');

    const cookie = extractSidCookie(response);
    // A client with authentication disabled for the local subnet answers "Ok." and sets nothing.
    const resolved = cookie ?? '';
    this.sessions.set(config.id, { cookie: resolved, expiresAt: Date.now() + SESSION_TTL_MS });
    return resolved;
  }

  private async resolveBaseUrl(config: ResolvedClientConfig): Promise<URL> {
    return ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
  }
}

function toDownloadStatus(hash: string, entry: QbTorrentInfo): DownloadStatus {
  const totalBytes = entry.total_size ?? entry.size ?? null;
  const state = mapState(entry.state);
  return {
    infoHash: hash,
    state,
    progressPercent: Math.max(0, Math.min(100, Math.round((entry.progress ?? 0) * 100))),
    downloadedBytes: entry.downloaded ?? 0,
    totalBytes: typeof totalBytes === 'number' && totalBytes > 0 ? totalBytes : null,
    contentPath: entry.content_path ?? entry.save_path ?? null,
    seed: toSeedInfo(entry),
    errorMessage: state === 'failed' ? `qBittorrent reported state "${entry.state ?? 'unknown'}"` : undefined,
  };
}

/**
 * The tracker's message, but only when every real tracker on the torrent has given up. One dead
 * tracker in a multi-tracker torrent is normal and says nothing about whether it can download, so
 * a single working or still-updating entry means there is nothing to report.
 */
function trackerFailure(trackers: QbTracker[]): string | null {
  const real = trackers.filter((tracker) => tracker.url && !PSEUDO_TRACKER.test(tracker.url));
  if (real.length === 0) return null;
  if (real.some((tracker) => tracker.status === 2 || tracker.status === 3)) return null;

  const failing = real.find((tracker) => tracker.status === 4 && tracker.msg?.trim());
  // The tracker writes this, so it is bounded before it reaches a database column, a notification
  // and the request list.
  return failing?.msg?.trim().slice(0, 200) ?? null;
}

/**
 * qBittorrent spells "no limit of my own" as a negative number on both goals, which is a goal the
 * torrent does not have rather than a goal of -1.
 */
function toSeedInfo(entry: QbTorrentInfo): SeedInfo {
  const seedingTimeLimit = entry.seeding_time_limit;
  return {
    seeding: entry.state !== undefined && SEEDING_STATES.has(entry.state),
    ratio: typeof entry.ratio === 'number' && entry.ratio >= 0 ? entry.ratio : null,
    ratioGoal: typeof entry.ratio_limit === 'number' && entry.ratio_limit >= 0 ? entry.ratio_limit : null,
    seedingTimeSeconds: typeof entry.seeding_time === 'number' && entry.seeding_time >= 0 ? entry.seeding_time : null,
    seedingTimeGoalMinutes: typeof seedingTimeLimit === 'number' && seedingTimeLimit >= 0 ? seedingTimeLimit : null,
    uploadedBytes: typeof entry.uploaded === 'number' && entry.uploaded >= 0 ? entry.uploaded : null,
  };
}

function mapState(state: string | undefined): DownloadState {
  if (!state) return 'unknown';
  if (FAILED_STATES.has(state)) return 'failed';
  if (COMPLETED_STATES.has(state)) return 'completed';
  if (QUEUED_STATES.has(state)) return 'queued';
  return 'downloading';
}

function extractSidCookie(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  for (const value of raw) {
    const match = /(?:^|;\s*)(SID=[^;]+)/.exec(value);
    if (match) return match[1];
  }
  return null;
}
