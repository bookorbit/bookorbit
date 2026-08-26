import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DownloadClientTestResult } from '@bookorbit/types';

import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import type { DownloadClientAdapter, DownloadState, DownloadStatus, GrabPayload, ResolvedClientConfig, SeedInfo } from '../download-client-adapter';
import { endpointUrl, fetchClient, readClientJson } from './client-http.utils';

const LABEL = 'Deluge';
const JSON_PATH = '/json';
/** Deluge's web session lasts an hour by default; re-login well before it lapses. */
const SESSION_TTL_MS = 30 * 60 * 1000;
/** A Web UI with a long host list is misconfigured rather than interesting, so stop trying. */
const HOST_ATTEMPT_LIMIT = 5;

/**
 * Asked for on every poll. Both spellings of the download folder are requested because 1.3 knows
 * only `save_path` and 2.x moved it to `download_location`; an unknown key is simply absent.
 */
const STATUS_FIELDS = [
  'hash',
  'name',
  'state',
  'progress',
  'total_done',
  'total_size',
  'total_wanted',
  'download_location',
  'save_path',
  'ratio',
  'stop_ratio',
  'stop_at_ratio',
  'seeding_time',
  'total_uploaded',
  'is_finished',
  'message',
  'tracker_status',
];

const STATE_BY_DELUGE: Record<string, DownloadState> = {
  Downloading: 'downloading',
  Seeding: 'completed',
  Error: 'failed',
  Queued: 'queued',
  Checking: 'queued',
  Allocating: 'queued',
  Moving: 'queued',
};

interface DelugeTorrent {
  hash?: string;
  name?: string;
  state?: string;
  /** Already a percentage, unlike qBittorrent's fraction. */
  progress?: number;
  total_done?: number;
  total_size?: number;
  total_wanted?: number;
  download_location?: string;
  save_path?: string;
  ratio?: number;
  stop_ratio?: number;
  stop_at_ratio?: boolean;
  seeding_time?: number;
  total_uploaded?: number;
  is_finished?: boolean;
  message?: string;
  tracker_status?: string;
}

interface DelugeError {
  message?: string;
  code?: number;
}

interface DelugeReply<T> {
  result?: T;
  error?: DelugeError | null;
  /** Only set by the login call, which is the one answer that establishes a session. */
  cookie: string | null;
}

interface DelugeSession {
  cookie: string;
  expiresAt: number;
  /** The Label plugin is optional and off by default, so labelling is conditional on it. */
  labelPlugin: boolean;
}

@Injectable()
export class DelugeAdapter implements DownloadClientAdapter {
  readonly type = 'deluge' as const;
  readonly label = LABEL;
  readonly delivers = 'torrent' as const;

  private readonly logger = new Logger(DelugeAdapter.name);
  private readonly sessions = new Map<number, DelugeSession>();
  private requestId = 0;

  async add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientHash: string }> {
    if (!release.torrentFile && !release.magnet) {
      throw new BadRequestException('A grab needs either a magnet link or a .torrent file');
    }

    const options: Record<string, unknown> = { add_paused: false };
    // The client enforces the goal, BookOrbit never stops a seed itself. Deluge has no seed-time
    // goal of any kind, so a tracker's minimum time is left seeding rather than stopped early.
    if (release.seedRatioGoal !== undefined) {
      options.stop_at_ratio = true;
      options.stop_ratio = release.seedRatioGoal;
      options.remove_at_ratio = false;
    }

    let hash: string;
    try {
      const added = release.torrentFile
        ? await this.rpc<string | null>(config, 'core.add_torrent_file', [
            release.torrentFileName ?? 'upload.torrent',
            release.torrentFile.toString('base64'),
            options,
          ])
        : await this.rpc<string | null>(config, 'core.add_torrent_magnet', [release.magnet, options]);
      hash = (added ?? release.infoHash).toLowerCase();
    } catch (error) {
      // Deluge refuses a torrent it already holds outright rather than adopting it. An earlier
      // attempt on this release leaves its torrent behind when the import fails, and without this
      // every retry of that release is refused forever. Only the client can say which case it is.
      if (!(await this.holds(release.infoHash, config))) throw error;
      this.logger.log(
        `[download_client.add] [end] clientId=${config.id} hash=${release.infoHash.toLowerCase()} adopted=true - the client already held this torrent`,
      );
      hash = release.infoHash.toLowerCase();
    }

    await this.applyLabel(hash, config);
    return { clientHash: hash };
  }

  /**
   * Whether the client is already holding this exact infohash. Any failure to find out answers
   * "no", so an unreachable client surfaces the add failure rather than a false success.
   */
  private async holds(infoHash: string, config: ResolvedClientConfig): Promise<boolean> {
    const hash = infoHash.toLowerCase();
    try {
      const result = await this.rpc<Record<string, DelugeTorrent> | null>(config, 'core.get_torrents_status', [{ id: [hash] }, ['hash']]);
      return Object.keys(result ?? {}).some((key) => key.toLowerCase() === hash);
    } catch {
      return false;
    }
  }

  /**
   * Deluge has no categories. The Label plugin is the closest equivalent and is off by default,
   * so this is best-effort: the torrent is already downloading by now, nothing in the poll loop
   * finds it by label, and failing the grab over a missing plugin would help nobody.
   */
  private async applyLabel(hash: string, config: ResolvedClientConfig): Promise<void> {
    const session = await this.session(config);
    if (!session.labelPlugin) return;

    const label = toLabelId(config.category);
    if (!label) return;

    try {
      // Adding a label that already exists is an error rather than a no-op, and the plugin offers
      // no "create if missing", so the refusal is the normal path from the second torrent onwards.
      await this.rpc(config, 'label.add', [label]).catch(() => undefined);
      await this.rpc(config, 'label.set_torrent', [hash, label]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.label] [fail] clientId=${config.id} hash=${hash} error="${sanitizeLogValue(detail)}" - the torrent was added but could not be labelled`,
      );
    }
  }

  async status(hashes: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]> {
    // An empty id filter means every torrent to Deluge, and answering a poll about nothing with
    // the entire queue would be worse than useless.
    if (hashes.length === 0) return [];

    const wanted = [...new Set(hashes.map((hash) => hash.toLowerCase()))];
    // Unbatched on purpose: this is a POST body rather than a query string, so the URL length that
    // forces qBittorrent to poll in chunks does not apply.
    const result = await this.rpc<Record<string, DelugeTorrent> | null>(config, 'core.get_torrents_status', [{ id: wanted }, STATUS_FIELDS]);
    const asked = new Set(wanted);

    return Object.entries(result ?? {}).flatMap(([key, entry]) => {
      const hash = (entry?.hash ?? key).toLowerCase();
      if (!asked.has(hash)) return [];
      return [toDownloadStatus(hash, entry ?? {})];
    });
  }

  async remove(hash: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void> {
    const removed = await this.rpc<boolean>(config, 'core.remove_torrent', [hash.toLowerCase(), opts.deleteFiles]);
    // Deluge answers a torrent it does not hold with `false` rather than an error, and a removal
    // that silently did nothing must not read as a success to the caller cleaning up after it.
    if (removed === false) throw new BadRequestException('Deluge did not remove that torrent');
  }

  async test(config: ResolvedClientConfig): Promise<DownloadClientTestResult> {
    try {
      return { success: true, version: await this.version(config) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[download_client.test] [fail] clientId=${config.id} error="${sanitizeLogValue(message)}" - Deluge connection test failed`);
      return { success: false, error: message };
    }
  }

  /** Deluge 2 renamed this call; 1.3 answers only the old spelling. */
  private async version(config: ResolvedClientConfig): Promise<string | undefined> {
    try {
      const modern = await this.rpc<string>(config, 'daemon.get_version', []);
      if (typeof modern === 'string' && modern.trim()) return modern.trim();
    } catch {
      // Falls through to the 1.3 spelling, which is the only thing this refusal can mean.
    }
    const legacy = await this.rpc<string>(config, 'daemon.info', []);
    return typeof legacy === 'string' ? legacy.trim() : undefined;
  }

  /** Drops the cached session so the next call re-authenticates against the current config. */
  forget(clientId: number): void {
    this.sessions.delete(clientId);
  }

  private async rpc<T>(config: ResolvedClientConfig, method: string, params: unknown[], retryOnAuthFailure = true): Promise<T> {
    const session = await this.session(config);
    const base = await this.resolveBaseUrl(config);
    const reply = await this.post<T>(base, session.cookie, method, params);

    if (reply.error) {
      // An expired session is reported as an ordinary error on whatever call hit it, so it looks
      // exactly like a refusal until the retry succeeds.
      if (retryOnAuthFailure && isAuthFailure(reply.error)) {
        this.sessions.delete(config.id);
        return this.rpc<T>(config, method, params, false);
      }
      throw new BadRequestException(`Deluge refused ${method}: ${reply.error.message?.trim() || 'no reason given'}`);
    }
    return reply.result as T;
  }

  private async session(config: ResolvedClientConfig): Promise<DelugeSession> {
    const cached = this.sessions.get(config.id);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const base = await this.resolveBaseUrl(config);
    // The Web UI authenticates with a password alone. Any username on the row belongs to the
    // daemon rather than to this interface, so sending it here would only be refused.
    const login = await this.post<boolean>(base, null, 'auth.login', [config.password ?? '']);
    if (login.error) throw new BadRequestException(`Deluge refused the login: ${login.error.message?.trim() || 'no reason given'}`);
    if (login.result !== true) throw new BadRequestException('Deluge rejected that password');
    if (!login.cookie) throw new BadRequestException('Deluge accepted the password but issued no session');

    await this.ensureDaemon(base, login.cookie);
    const plugins = await this.post<string[]>(base, login.cookie, 'core.get_enabled_plugins', []);

    const session: DelugeSession = {
      cookie: login.cookie,
      expiresAt: Date.now() + SESSION_TTL_MS,
      labelPlugin: Array.isArray(plugins.result) && plugins.result.includes('Label'),
    };
    this.sessions.set(config.id, session);
    return session;
  }

  /**
   * The Web UI is a separate process from the daemon that holds the torrents, and a freshly
   * started one is attached to nothing. Every call then answers "not connected" while the password
   * was perfectly good, so a session is not usable until a daemon is attached to it.
   */
  private async ensureDaemon(base: URL, cookie: string): Promise<void> {
    const connected = await this.post<boolean>(base, cookie, 'web.connected', []);
    if (connected.result === true) return;

    const hosts = await this.post<unknown[][]>(base, cookie, 'web.get_hosts', []);
    const candidates = Array.isArray(hosts.result) ? hosts.result.slice(0, HOST_ATTEMPT_LIMIT) : [];
    for (const host of candidates) {
      const hostId = Array.isArray(host) ? host[0] : null;
      if (typeof hostId !== 'string') continue;
      const attempt = await this.post(base, cookie, 'web.connect', [hostId]);
      if (!attempt.error) return;
    }
    throw new BadRequestException('Deluge is not connected to a daemon, and none of the hosts it knows about accepted a connection');
  }

  /** One JSON-RPC call. Deliberately below the session layer, so establishing one can use it. */
  private async post<T>(base: URL, cookie: string | null, method: string, params: unknown[]): Promise<DelugeReply<T>> {
    this.requestId += 1;
    const response = await fetchClient(
      endpointUrl(base, jsonPath(base)),
      {
        method: 'POST',
        body: JSON.stringify({ method, params, id: this.requestId }),
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      },
      LABEL,
    );

    if (!response.ok) throw new BadRequestException(`Deluge answered ${response.status} for ${method}`);

    const payload = await readClientJson<{ result?: T; error?: DelugeError | null }>(response, LABEL);
    return { result: payload.result, error: payload.error ?? null, cookie: extractSessionCookie(response) };
  }

  private async resolveBaseUrl(config: ResolvedClientConfig): Promise<URL> {
    return ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
  }
}

/**
 * An operator may paste the Web UI's root or the JSON endpoint itself, and appending the path to a
 * URL that already carries it produces a 404 that reads like the client is down.
 */
function jsonPath(base: URL): string {
  return /\/json\/?$/.test(base.pathname) ? '' : JSON_PATH;
}

/**
 * The Label plugin accepts lowercase letters, digits, dashes and underscores only, while the
 * category field allows spaces and dots. Folding rather than refusing: the category is already
 * saved, and a label is a convenience the operator should not have to re-type to get.
 */
function toLabelId(category: string): string | null {
  const label = category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return label || null;
}

/**
 * Deluge reports an expired session as an ordinary RPC error on the call that hit it. The code is
 * matched first because the message is localised in some builds.
 */
function isAuthFailure(error: DelugeError): boolean {
  return error.code === 1 || /not authenticated|auth/i.test(error.message ?? '');
}

function extractSessionCookie(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  for (const value of raw) {
    const match = /(?:^|;\s*)(_session_id=[^;]+)/.exec(value);
    if (match) return match[1];
  }
  return null;
}

function toDownloadStatus(hash: string, entry: DelugeTorrent): DownloadStatus {
  const totalBytes = entry.total_wanted ?? entry.total_size ?? null;
  const state = mapState(entry);
  const tracker = trackerFailure(entry);
  return {
    infoHash: hash,
    state,
    progressPercent: Math.max(0, Math.min(100, Math.round(entry.progress ?? 0))),
    downloadedBytes: entry.total_done ?? 0,
    totalBytes: typeof totalBytes === 'number' && totalBytes > 0 ? totalBytes : null,
    contentPath: contentPath(entry),
    seed: toSeedInfo(entry),
    errorMessage: state === 'failed' ? entry.message?.trim() || 'Deluge reported an error state' : undefined,
    ...(tracker ? { trackerError: tracker } : {}),
  };
}

/** Deluge reports the folder and the name apart; everything downstream wants the content. */
function contentPath(entry: DelugeTorrent): string | null {
  const dir = (entry.download_location ?? entry.save_path)?.trim();
  if (!dir) return null;
  const name = entry.name?.trim();
  return name ? `${dir.replace(/\/+$/, '')}/${name}` : dir;
}

/**
 * Deluge folds every tracker's answer into one string per torrent. A torrent whose announce is
 * refused stays in `Downloading` indefinitely, looking exactly like one that has not found a peer
 * yet, so this string is the only thing that tells the two apart.
 */
function trackerFailure(entry: DelugeTorrent): string | null {
  const status = entry.tracker_status?.trim();
  if (!status || !/error/i.test(status)) return null;
  return status.slice(0, 200);
}

function toSeedInfo(entry: DelugeTorrent): SeedInfo {
  return {
    seeding: entry.state === 'Seeding',
    ratio: typeof entry.ratio === 'number' && entry.ratio >= 0 ? entry.ratio : null,
    // `stop_ratio` carries a number whether or not it is being enforced, so the flag beside it is
    // what decides whether this torrent has a goal at all.
    ratioGoal: entry.stop_at_ratio === true && typeof entry.stop_ratio === 'number' ? entry.stop_ratio : null,
    seedingTimeSeconds: typeof entry.seeding_time === 'number' && entry.seeding_time >= 0 ? entry.seeding_time : null,
    // Deluge has no seed-time goal to report, and claiming one it does not enforce would be worse
    // than saying there is none.
    seedingTimeGoalMinutes: null,
    uploadedBytes: typeof entry.total_uploaded === 'number' && entry.total_uploaded >= 0 ? entry.total_uploaded : null,
  };
}

function mapState(entry: DelugeTorrent): DownloadState {
  if (!entry.state) return 'unknown';
  // Paused covers a held download and a finished torrent that reached its goal alike, and only
  // the completion tells the two apart.
  if (entry.state === 'Paused') return entry.is_finished === true || (entry.progress ?? 0) >= 100 ? 'completed' : 'queued';
  return STATE_BY_DELUGE[entry.state] ?? 'unknown';
}
