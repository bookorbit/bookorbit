import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DownloadClientTestResult } from '@bookorbit/types';

import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import type { DownloadClientAdapter, DownloadState, DownloadStatus, GrabPayload, ResolvedClientConfig, SeedInfo } from '../download-client-adapter';
import { basicAuthHeader, endpointUrl, fetchClient, readClientJson } from './client-http.utils';

const LABEL = 'Transmission';
const RPC_PATH = '/transmission/rpc';
/** Transmission's CSRF header, spelled lowercase because `Headers` matches case-insensitively. */
const SESSION_HEADER = 'x-transmission-session-id';

/** Transmission's `status` enum, which is a position in its queue rather than a description. */
const STATUS_STOPPED = 0;
const STATUS_CHECK_WAIT = 1;
const STATUS_CHECK = 2;
const STATUS_DOWNLOAD_WAIT = 3;
const STATUS_DOWNLOAD = 4;
const STATUS_SEED_WAIT = 5;
const STATUS_SEED = 6;

/** A torrent's `error`: 1 tracker warning, 2 tracker error, 3 local error. */
const ERROR_TRACKER = 2;
const ERROR_LOCAL = 3;

/** `seedRatioMode`: 0 follows the global limit, 1 is this torrent's own, 2 is unlimited. */
const RATIO_MODE_SINGLE = 1;

/**
 * Asked for on every poll. `error` and `errorString` are what make a refused announce visible:
 * Transmission reports it on the torrent itself, so unlike qBittorrent there is no second
 * per-torrent call to make.
 */
const STATUS_FIELDS = [
  'hashString',
  'name',
  'status',
  'percentDone',
  'downloadedEver',
  'sizeWhenDone',
  'totalSize',
  'downloadDir',
  'error',
  'errorString',
  'uploadRatio',
  'seedRatioLimit',
  'seedRatioMode',
  'secondsSeeding',
  'uploadedEver',
  'isFinished',
];

interface TransmissionTorrent {
  hashString?: string;
  name?: string;
  status?: number;
  percentDone?: number;
  downloadedEver?: number;
  sizeWhenDone?: number;
  totalSize?: number;
  downloadDir?: string;
  error?: number;
  errorString?: string;
  uploadRatio?: number;
  seedRatioLimit?: number;
  seedRatioMode?: number;
  secondsSeeding?: number;
  uploadedEver?: number;
  isFinished?: boolean;
}

interface TransmissionAddResult {
  'torrent-added'?: { hashString?: string };
  'torrent-duplicate'?: { hashString?: string };
}

@Injectable()
export class TransmissionAdapter implements DownloadClientAdapter {
  readonly type = 'transmission' as const;
  readonly label = LABEL;
  readonly delivers = 'torrent' as const;

  private readonly logger = new Logger(TransmissionAdapter.name);
  /** The CSRF token the daemon issued, per client row. Not a login: it survives no restart. */
  private readonly sessions = new Map<number, string>();

  async add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientHash: string }> {
    const args: Record<string, unknown> = { paused: false };
    if (release.torrentFile) {
      args.metainfo = release.torrentFile.toString('base64');
    } else if (release.magnet) {
      args.filename = release.magnet;
    } else {
      throw new BadRequestException('A grab needs either a magnet link or a .torrent file');
    }

    const downloadDir = await this.categoryDir(config);
    if (downloadDir) args['download-dir'] = downloadDir;

    const result = await this.rpc<TransmissionAddResult>(config, 'torrent-add', args);
    // A torrent the daemon already holds comes back as `torrent-duplicate` with a success result
    // rather than an error. An earlier attempt on this release leaves its torrent behind when the
    // import fails, and the torrent we asked for being present is the outcome we wanted.
    const duplicate = result['torrent-duplicate'];
    const added = result['torrent-added'] ?? duplicate;
    const hash = added?.hashString?.toLowerCase();
    if (!hash) throw new BadRequestException('Transmission accepted the torrent but named no infohash');

    if (duplicate) {
      this.logger.log(`[download_client.adopt] [end] clientId=${config.id} hash=${hash} - the client already held this torrent`);
    }
    // The poll loop asks about the hash the grab was recorded under, so a client that named a
    // different one would leave the download sitting in `queued` until the watchdog gave up.
    if (hash !== release.infoHash.toLowerCase()) {
      this.logger.warn(
        `[download_client.add] [fail] clientId=${config.id} hash=${hash} expected=${release.infoHash.toLowerCase()} - Transmission named a different infohash`,
      );
    }

    await this.applySeedGoal(hash, release, config);
    return { clientHash: hash };
  }

  /**
   * Transmission takes no limits on the add itself, so the goal is a second call. Only the ratio:
   * its one time limit is an *idle* limit, which stops a quiet torrent early rather than holding
   * it for a tracker's minimum, so honouring a seed-time goal with it would under-seed exactly
   * the private trackers the goal exists to satisfy.
   *
   * Best-effort, like Deluge's labelling: the torrent is already running by the time this is
   * called, so throwing here fails a grab whose download has started. Automation would move on to
   * the next release while the orphan went on downloading with nothing in BookOrbit pointing at
   * it. A missed ratio limit is a seeding policy the operator has to set by hand; the orphan is
   * a download nobody can see.
   */
  private async applySeedGoal(hash: string, release: GrabPayload, config: ResolvedClientConfig): Promise<void> {
    if (release.seedRatioGoal === undefined) return;
    const started = Date.now();
    try {
      await this.rpc(config, 'torrent-set', { ids: [hash], seedRatioLimit: release.seedRatioGoal, seedRatioMode: RATIO_MODE_SINGLE });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.seed_goal] [fail] clientId=${config.id} hash=${hash} ratio=${release.seedRatioGoal} durationMs=${Date.now() - started} errorClass=${error instanceof Error ? error.constructor.name : 'UnknownError'} error="${sanitizeLogValue(detail)}" - the torrent was added but its seed ratio goal could not be set`,
      );
    }
  }

  /**
   * Transmission has no categories, so the category becomes a subfolder of the daemon's own
   * download directory. Read per add rather than cached, so moving that directory does not need
   * BookOrbit restarted to take effect.
   */
  private async categoryDir(config: ResolvedClientConfig): Promise<string | null> {
    const category = config.category.trim();
    // The DTO bounds the character set, but `..` sits inside it and this becomes a path segment
    // on the client's own filesystem.
    if (!category || /^\.+$/.test(category)) return null;

    const session = await this.rpc<{ 'download-dir'?: string }>(config, 'session-get', {});
    const base = session['download-dir']?.trim();
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/${category}`;
  }

  async status(hashes: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]> {
    // An empty `ids` array is not the same as no torrents to Transmission on every version in the
    // wild, and answering a poll about nothing with the entire queue would be worse than useless.
    if (hashes.length === 0) return [];

    const wanted = [...new Set(hashes.map((hash) => hash.toLowerCase()))];
    // Unbatched on purpose: this is a POST body rather than a query string, so the URL length that
    // forces qBittorrent to poll in chunks does not apply.
    const result = await this.rpc<{ torrents?: TransmissionTorrent[] }>(config, 'torrent-get', { ids: wanted, fields: STATUS_FIELDS });
    const asked = new Set(wanted);

    return (result.torrents ?? []).flatMap((entry) => {
      const hash = entry.hashString?.toLowerCase();
      if (!hash || !asked.has(hash)) return [];
      return [toDownloadStatus(hash, entry)];
    });
  }

  async remove(hash: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void> {
    await this.rpc(config, 'torrent-remove', { ids: [hash.toLowerCase()], 'delete-local-data': opts.deleteFiles });
  }

  async test(config: ResolvedClientConfig): Promise<DownloadClientTestResult> {
    try {
      const session = await this.rpc<{ version?: string }>(config, 'session-get', {});
      return { success: true, version: session.version?.trim() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.test] [fail] clientId=${config.id} error="${sanitizeLogValue(message)}" - Transmission connection test failed`,
      );
      return { success: false, error: message };
    }
  }

  /** Drops the CSRF token so the next call takes a fresh one from the current address. */
  forget(clientId: number): void {
    this.sessions.delete(clientId);
  }

  private async rpc<T>(config: ResolvedClientConfig, method: string, args: Record<string, unknown>, retryOnHandshake = true): Promise<T> {
    const base = await this.resolveBaseUrl(config);
    const token = this.sessions.get(config.id);
    const response = await fetchClient(
      endpointUrl(base, rpcPath(base)),
      {
        method: 'POST',
        body: JSON.stringify({ method, arguments: args }),
        headers: {
          'Content-Type': 'application/json',
          ...basicAuthHeader(config.username, config.password),
          ...(token ? { [SESSION_HEADER]: token } : {}),
        },
      },
      LABEL,
    );

    // A 409 is the handshake rather than a failure: Transmission refuses any call without the
    // current CSRF token and hands out the one to use in the same answer. It recurs on every
    // daemon restart, so it cannot be done once at startup.
    if (response.status === 409 && retryOnHandshake) {
      const issued = response.headers.get(SESSION_HEADER);
      if (!issued) throw new BadRequestException('Transmission asked for a session id but issued none');
      this.sessions.set(config.id, issued);
      return this.rpc<T>(config, method, args, false);
    }
    if (response.status === 401) throw new BadRequestException('Transmission rejected those credentials');
    if (!response.ok) throw new BadRequestException(`Transmission answered ${response.status} for ${method}`);

    const payload = await readClientJson<{ result?: string; arguments?: T }>(response, LABEL);
    // The one 200 that is not success: Transmission reports a refusal in the body with the reason
    // as a string, and an empty queue and a rejected request look identical without it.
    if (payload.result !== 'success') {
      throw new BadRequestException(`Transmission refused ${method}: ${payload.result ?? 'no reason given'}`);
    }
    return (payload.arguments ?? ({} as T)) as T;
  }

  private async resolveBaseUrl(config: ResolvedClientConfig): Promise<URL> {
    return ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
  }
}

/**
 * An operator may paste the daemon's root or the RPC endpoint itself, and appending the path to a
 * URL that already carries it produces a 404 that reads like the client is down.
 */
function rpcPath(base: URL): string {
  return /\/transmission\/rpc\/?$/.test(base.pathname) ? '' : RPC_PATH;
}

function toDownloadStatus(hash: string, entry: TransmissionTorrent): DownloadStatus {
  const totalBytes = entry.sizeWhenDone ?? entry.totalSize ?? null;
  const state = mapState(entry);
  return {
    infoHash: hash,
    state,
    progressPercent: Math.max(0, Math.min(100, Math.round((entry.percentDone ?? 0) * 100))),
    downloadedBytes: entry.downloadedEver ?? 0,
    totalBytes: typeof totalBytes === 'number' && totalBytes > 0 ? totalBytes : null,
    contentPath: contentPath(entry),
    seed: toSeedInfo(entry),
    errorMessage: state === 'failed' ? entry.errorString?.trim() || 'Transmission reported a local error' : undefined,
    // Transmission separates a refused announce from a local failure, and only the local one means
    // the download is over. A refused announce leaves a healthy-looking torrent that will never
    // find a peer, which is the case this field exists for.
    ...(entry.error === ERROR_TRACKER && entry.errorString?.trim() ? { trackerError: entry.errorString.trim().slice(0, 200) } : {}),
  };
}

/** Transmission reports the folder and the name apart; everything downstream wants the content. */
function contentPath(entry: TransmissionTorrent): string | null {
  const dir = entry.downloadDir?.trim();
  if (!dir) return null;
  const name = entry.name?.trim();
  return name ? `${dir.replace(/\/+$/, '')}/${name}` : dir;
}

function toSeedInfo(entry: TransmissionTorrent): SeedInfo {
  return {
    seeding: entry.status === STATUS_SEED || entry.status === STATUS_SEED_WAIT,
    ratio: typeof entry.uploadRatio === 'number' && entry.uploadRatio >= 0 ? entry.uploadRatio : null,
    // Any other mode defers to the global limit or to no limit at all, and the number sitting
    // beside it is then a leftover rather than the goal this torrent is held to.
    ratioGoal: entry.seedRatioMode === RATIO_MODE_SINGLE && typeof entry.seedRatioLimit === 'number' ? entry.seedRatioLimit : null,
    seedingTimeSeconds: typeof entry.secondsSeeding === 'number' && entry.secondsSeeding >= 0 ? entry.secondsSeeding : null,
    // Transmission's only time limit is an idle one, so it has no goal to report here. Claiming
    // the idle limit as a seed-time goal would promise a minimum it does not enforce.
    seedingTimeGoalMinutes: null,
    uploadedBytes: typeof entry.uploadedEver === 'number' && entry.uploadedEver >= 0 ? entry.uploadedEver : null,
  };
}

function mapState(entry: TransmissionTorrent): DownloadState {
  if (entry.error === ERROR_LOCAL) return 'failed';
  switch (entry.status) {
    case STATUS_SEED:
    case STATUS_SEED_WAIT:
      return 'completed';
    case STATUS_DOWNLOAD:
      return 'downloading';
    case STATUS_CHECK:
    case STATUS_CHECK_WAIT:
    case STATUS_DOWNLOAD_WAIT:
      return 'queued';
    // Stopped says nothing by itself: it covers a paused download and a torrent that finished and
    // reached its goal alike, and only the completion tells the two apart.
    case STATUS_STOPPED:
      return entry.isFinished === true || entry.percentDone === 1 ? 'completed' : 'queued';
    default:
      return 'unknown';
  }
}
