import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DownloadClientTestResult } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import type {
  DownloadClientAdapter,
  DownloadState,
  DownloadStatus,
  GrabPayload,
  OwnedDownloadClientInventory,
  ResolvedClientConfig,
  SeedInfo,
} from '../download-client-adapter';
import { type ClientContent, DownloadContentRemovalService } from '../download-content-removal.service';
import { basicAuthHeader, fetchClient, readClientText, throwForClientServerError } from './client-http.utils';
import {
  decodeMethodResponse,
  decodeMulticallResults,
  encodeMethodCall,
  XmlRpcFault,
  XmlRpcMalformedError,
  type XmlRpcParam,
  type XmlRpcValue,
} from './xml-rpc.utils';

const LABEL = 'rTorrent';

/** What an operator who pastes only the host means: every common setup serves XML-RPC here. */
const DEFAULT_RPC_PATH = '/RPC2';

/**
 * Hashes per status request. Each costs one call per field, and the web server in front of
 * rTorrent refuses request bodies over 1 MB by default; fifty hashes is about a tenth of that.
 */
const STATUS_BATCH = 50;

/** Same cap the other adapters apply: a seedbox holds far more than a page should render. */
const RECONCILIATION_LIMIT = 1000;

const MESSAGE_LIMIT = 200;

const INFO_HASH = /^[0-9a-f]{40}$/;

/**
 * rTorrent answers every `load.*` call with 0, including for a corrupt file or a malformed magnet,
 * and reports the failure only in its own log. The torrent appearing is the only confirmation
 * there is. On an idle daemon it appears on the very next call, so this is a margin.
 */
const ADD_CONFIRM_DELAYS_MS = [0, 100, 250, 500, 1000, 2000];

/**
 * rTorrent queues loads and works through them at about fifty a second on 0.9.8, so a grab that
 * arrives behind a burst from another tool lands long after the window above. While the number of
 * torrents keeps changing the load may still be queued; once it holds still, the load was dropped.
 * Past the last poll the grab is left to the download monitor, which already waits for late items.
 */
const ADD_QUEUE_POLL_MS = 1000;
const ADD_QUEUE_POLLS = 15;

/** Read per torrent in one `system.multicall`. `toDownloadStatus` reads them by name. */
const STATUS_FIELDS = [
  'd.name',
  'd.size_bytes',
  'd.completed_bytes',
  'd.complete',
  'd.state',
  'd.is_open',
  'd.is_active',
  'd.is_hash_checking',
  'd.message',
  'd.base_path',
  'd.directory',
  'd.is_multi_file',
  'd.ratio',
  'd.up.total',
  'd.timestamp.finished',
] as const;

/** Hashes per label read where `d.multicall.filtered` is missing: one call each, the size of a status batch. */
const LABEL_BATCH = STATUS_BATCH * STATUS_FIELDS.length;

/**
 * Labels an exact-match filter can carry. Inside the braces of a filter, rTorrent splits on a comma
 * or a brace and drops a quote or a backslash even when quoted, so on every version tested a label
 * with one matched nothing. Those are read a torrent at a time instead.
 */
const FILTERABLE_LABEL = /^[\p{L}\p{N} ._-]+$/u;

/** Rows one filtered status read may bring back, about 9 MB. Past it, the owned torrents are read by hash. */
const FILTERED_READ_LIMIT = 10_000;

type StatusField = (typeof STATUS_FIELDS)[number];
type TorrentRow = Record<StatusField, XmlRpcValue>;

interface MulticallEntry {
  methodName: string;
  params: XmlRpcParam[];
}

/** A fault from a single call, kept with the method it answered so the operator sees which. */
class RtorrentRefusal extends BadRequestException {
  constructor(
    readonly method: string,
    readonly fault: XmlRpcFault,
  ) {
    super(`rTorrent refused ${method}: ${fault.reason}`);
  }
}

/**
 * rTorrent over XML-RPC, at whatever HTTP endpoint fronts it: `/RPC2` behind nginx or lighttpd,
 * or ruTorrent's `plugins/httprpc/action.php`, which passes XML-RPC through unchanged. No session:
 * Basic auth, when there is any, goes with every request, so nothing outlives a config change.
 *
 * Behaviour this relies on was observed on rTorrent 0.9.7, 0.9.8, 0.15.5, 0.16.25 and jesec 0.9.8-r16;
 * the live rig is in the notes repository under `rigs/rtorrent`.
 */
@Injectable()
export class RtorrentAdapter implements DownloadClientAdapter {
  readonly type = 'rtorrent' as const;
  readonly label = LABEL;
  readonly delivers = 'torrent' as const;

  private readonly logger = new Logger(RtorrentAdapter.name);

  constructor(private readonly contentRemoval: DownloadContentRemovalService) {}

  async add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientKey: string }> {
    if (!release.torrentFile && !release.magnet) {
      throw new BadRequestException('A grab needs either a magnet link or a .torrent file');
    }

    const hash = release.clientKey.toLowerCase();
    if (!INFO_HASH.test(hash)) throw new BadRequestException('rTorrent identifies a download by its 40-character infohash');
    const target = hash.toUpperCase();
    const label = config.category.trim();

    // Loading a torrent rTorrent already holds is a silent no-op, so it has to be asked first. An
    // earlier attempt on this release leaves its torrent behind when the import fails, and that
    // torrent being present is the outcome this grab wanted.
    if (await this.holds(target, config)) {
      this.logger.log(`[download_client.add] [end] clientId=${config.id} hash=${hash} adopted=true - the client already held this torrent`);
      if (label) await this.relabel(target, label, config);
      return { clientKey: hash };
    }

    // The label and nothing else. rTorrent creates only the last folder of a multi-file torrent's
    // directory, so a category folder of BookOrbit's own would leave the first multi-file grab into
    // it started, inactive and silent. Where files land stays rTorrent's own configuration.
    const commands = label ? [command('d.custom1.set', label)] : [];

    if (release.torrentFile) {
      await this.call(config, 'load.raw_start', ['', release.torrentFile, ...commands]);
    } else {
      await this.call(config, 'load.start', ['', release.magnet ?? '', ...commands]);
    }

    const arrival = await this.arrival(target, config);
    if (arrival === 'dropped') {
      // Seen on every version: with DHT off, as private-tracker seedboxes run it, a magnet that
      // names no tracker has nowhere to find its metadata and is dropped without a word.
      if (!release.torrentFile && !magnetNamesTracker(release.magnet ?? '')) {
        throw new BadRequestException(
          'rTorrent did not take the magnet link. It names no tracker, and rTorrent drops such a link when its DHT is off. Grab a release with a .torrent file or a tracker in its magnet link.',
        );
      }
      throw new BadRequestException(
        'rTorrent did not take the torrent. It reports why only in its own log: the file may be corrupt, the magnet link invalid, or its download directory unusable.',
      );
    }

    if (arrival === 'queued') {
      this.logger.warn(
        `[download_client.add] [end] clientId=${config.id} hash=${hash} listed=false - rTorrent is still working through queued loads, so the download monitor keeps looking for this one`,
      );
    } else if (label) {
      await this.confirmLabel(target, label, config);
    }

    if (release.seedRatioGoal !== undefined || release.seedTimeMinutes !== undefined) {
      this.logger.log(
        `[download_client.seed_goal] [end] clientId=${config.id} hash=${hash} applied=false - rTorrent has no per-torrent seed goal, so its own ratio rules apply`,
      );
    }
    return { clientKey: hash };
  }

  /**
   * A load command rTorrent cannot parse is dropped while the torrent still loads, and an
   * unlabelled torrent is one reconciliation can never find again. Read back once and set
   * directly when it did not stick.
   */
  private async confirmLabel(target: string, label: string, config: ResolvedClientConfig): Promise<void> {
    const current = await this.call(config, 'd.custom1', [target]).catch(() => null);
    if (current === label) return;
    this.logger.warn(
      `[download_client.label] [end] clientId=${config.id} hash=${target.toLowerCase()} - the load did not apply the label, so it was set directly`,
    );
    await this.relabel(target, label, config);
  }

  /** Best effort, like Deluge's labelling: the torrent is already running, and the poll finds it by hash. */
  private async relabel(target: string, label: string, config: ResolvedClientConfig): Promise<void> {
    try {
      await this.call(config, 'd.custom1.set', [target, label]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.label] [fail] clientId=${config.id} hash=${target.toLowerCase()} errorClass=${error instanceof Error ? error.constructor.name : 'UnknownError'} error="${sanitizeLogValue(detail)}" - the torrent was adopted but could not be labelled`,
      );
    }
  }

  private async arrival(target: string, config: ResolvedClientConfig): Promise<'listed' | 'queued' | 'dropped'> {
    for (const delay of ADD_CONFIRM_DELAYS_MS) {
      if (delay > 0) await wait(delay);
      if (await this.holds(target, config)) return 'listed';
    }

    let torrents = await this.torrentCount(config);
    for (let poll = 0; poll < ADD_QUEUE_POLLS; poll += 1) {
      await wait(ADD_QUEUE_POLL_MS);
      if (await this.holds(target, config)) return 'listed';
      const now = await this.torrentCount(config);
      // Asked again because the load may have landed between the two reads while another
      // torrent was erased, leaving the count where it was.
      if (now === torrents) return (await this.holds(target, config)) ? 'listed' : 'dropped';
      torrents = now;
    }
    return 'queued';
  }

  private async torrentCount(config: ResolvedClientConfig): Promise<number> {
    return count(await this.call(config, 'view.size', ['', 'main']));
  }

  private async holds(target: string, config: ResolvedClientConfig): Promise<boolean> {
    try {
      await this.call(config, 'd.hash', [target]);
      return true;
    } catch (error) {
      if (error instanceof RtorrentRefusal && isUnknownHash(error.fault)) return false;
      throw error;
    }
  }

  async status(clientKeys: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]> {
    // An empty batch would still cost a request, and answers nothing.
    if (clientKeys.length === 0) return [];

    const wanted = [...new Set(clientKeys.map((key) => key.toLowerCase()))];
    const statuses: DownloadStatus[] = [];
    for (const [hash, row] of await this.readTorrents(wanted, config)) statuses.push(toDownloadStatus(hash, row));
    return statuses;
  }

  async listOwned(config: ResolvedClientConfig): Promise<OwnedDownloadClientInventory> {
    const label = config.category.trim();
    // A blank marker would claim every unlabelled torrent in the instance.
    if (!label) return { supported: false, truncated: false, items: [] };

    const { labels, filtered } = await this.labels(config);
    const owned = labels.flatMap(([hash, custom1]) => (carriesLabel(custom1, label) ? [hash] : []));
    const shown = owned.slice(0, RECONCILIATION_LIMIT);

    // rTorrent walks its whole list for every hash: among 16,800 torrents, reading a thousand by hash
    // took 4 to 18 s. The ones carrying BookOrbit's spelling of the label come back in one more pass
    // instead, in under a second; whatever that pass leaves out is still read by hash.
    const exact = filtered && FILTERABLE_LABEL.test(label) ? labels.filter(([, custom1]) => custom1 === label).length : 0;
    const rows = exact > 0 && exact <= FILTERED_READ_LIMIT ? await this.readLabelled(label, config) : new Map<string, TorrentRow>();
    const missed = shown.filter((hash) => !rows.has(hash));
    for (const [hash, row] of await this.readTorrents(missed, config)) rows.set(hash, row);

    return {
      supported: true,
      truncated: owned.length > RECONCILIATION_LIMIT,
      items: shown.flatMap((hash) => {
        const row = rows.get(hash);
        return row ? [{ ...toDownloadStatus(hash, row), name: text(row['d.name']).trim() || hash }] : [];
      }),
    };
  }

  /** The torrents labelled exactly this, with every status field, in one pass. */
  private async readLabelled(label: string, config: ResolvedClientConfig): Promise<Map<string, TorrentRow>> {
    const listing = await this.call(config, 'd.multicall.filtered', [
      '',
      'main',
      `equal={d.custom1=,cat="${label}"}`,
      'd.hash=',
      ...STATUS_FIELDS.map((field) => `${field}=`),
    ]);
    const rows = new Map<string, TorrentRow>();
    for (const row of Array.isArray(listing) ? listing : []) {
      if (!Array.isArray(row) || row.length !== STATUS_FIELDS.length + 1) continue;
      const hash = infoHash(row[0]);
      if (!hash) continue;
      rows.set(hash, Object.fromEntries(STATUS_FIELDS.map((field, position) => [field, row[position + 1]])) as TorrentRow);
    }
    return rows;
  }

  /**
   * Every labelled torrent's hash and label. The view is every torrent on the seedbox and only a few
   * are BookOrbit's, so this is all that is read for it. Never through `d.multicall2`: up to 0.9.8,
   * rTorrent copies the view onto the stack of its XML-RPC thread, which on musl, so in most Docker
   * images, has 128 KiB, and past about 16,000 torrents the daemon crashes. `d.multicall.filtered`
   * collects on the heap, in one pass.
   */
  private async labels(config: ResolvedClientConfig): Promise<{ labels: Array<[string, XmlRpcValue]>; filtered: boolean }> {
    let listing: XmlRpcValue;
    try {
      listing = await this.call(config, 'd.multicall.filtered', ['', 'main', 'd.custom1=', 'd.hash=', 'd.custom1=']);
    } catch (error) {
      if (error instanceof RtorrentRefusal && isUnknownMethod(error.fault)) return { labels: await this.labelsOneByOne(config), filtered: false };
      throw error;
    }
    const labels = (Array.isArray(listing) ? listing : []).flatMap((row): Array<[string, XmlRpcValue]> => {
      if (!Array.isArray(row)) return [];
      const hash = infoHash(row[0]);
      return hash ? [[hash, row[1]]] : [];
    });
    return { labels, filtered: true };
  }

  /**
   * rTorrent 0.9.7 and older have no `d.multicall.filtered`. `download_list` is safe at any size, but
   * rTorrent finds each hash by walking its list, so on a large seedbox this is slow.
   */
  private async labelsOneByOne(config: ResolvedClientConfig): Promise<Array<[string, XmlRpcValue]>> {
    const listing = await this.call(config, 'download_list', ['', 'main']);
    const hashes = [...new Set((Array.isArray(listing) ? listing : []).flatMap((value) => infoHash(value) ?? []))];
    const labels: Array<[string, XmlRpcValue]> = [];
    for (let start = 0; start < hashes.length; start += LABEL_BATCH) {
      const batch = hashes.slice(start, start + LABEL_BATCH);
      const results = await this.multicall(
        config,
        batch.map((hash) => ({ methodName: 'd.custom1', params: [hash.toUpperCase()] })),
      );
      batch.forEach((hash, index) => {
        const custom1 = results[index];
        if (custom1 instanceof XmlRpcFault) {
          // Erased since the listing.
          if (isUnknownHash(custom1)) return;
          throw new RtorrentRefusal('d.custom1', custom1);
        }
        labels.push([hash, custom1]);
      });
    }
    return labels;
  }

  async remove(clientKey: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void> {
    const hash = clientKey.toLowerCase();
    const target = hash.toUpperCase();
    if (!opts.deleteFiles) {
      await this.erase(target, config);
      return;
    }

    // rTorrent's erase never touches the data, and nothing in its XML-RPC deletes it, so BookOrbit
    // deletes the files itself through the path mapping. Everything that can refuse is checked
    // first, while the torrent is still in the client.
    const content = await this.readContent(target, config);
    if (!content) return;
    const plan = content.root ? await this.contentRemoval.plan(config.id, content) : null;

    await this.erase(target, config);
    if (!plan) return;

    // Past the erase, nothing is thrown: the torrent is gone, and a removal reported as failed
    // would leave the attempt in flight for the monitor to find missing and retry, which is the
    // opposite of what was asked. Whatever could be refused was refused before the erase.
    const started = Date.now();
    this.logger.log(
      `[download_client.delete_files] [start] clientId=${config.id} hash=${hash} files=${plan.files.length} - deleting the files rTorrent left`,
    );
    const outcome = await this.contentRemoval.execute(plan);
    if (outcome.failures.length > 0) {
      const codes = [...new Set(outcome.failures.map((failure) => failure.code))].join(',');
      this.logger.warn(
        `[download_client.delete_files] [fail] clientId=${config.id} hash=${hash} deleted=${outcome.deleted} failed=${outcome.failures.length} durationMs=${Date.now() - started} errorClass=FilesystemError error="${sanitizeLogValue(codes)}" path="${sanitizeLogValue(outcome.failures[0].path)}" - the torrent was removed but some of its files remain`,
      );
      return;
    }
    this.logger.log(
      `[download_client.delete_files] [end] clientId=${config.id} hash=${hash} deleted=${outcome.deleted} folder=${plan.topDirectory ? (outcome.topDirectoryRemoved ? 'removed' : 'kept') : 'none'} durationMs=${Date.now() - started} - deleted the torrent's files`,
    );
  }

  /** A hash rTorrent no longer holds is a removal already done, not a failure. */
  private async erase(target: string, config: ResolvedClientConfig): Promise<void> {
    try {
      await this.call(config, 'd.erase', [target]);
    } catch (error) {
      if (!(error instanceof RtorrentRefusal && isUnknownHash(error.fault))) throw error;
    }
  }

  /** Null when rTorrent no longer holds the torrent. A root of '' means there is nothing on disk to delete. */
  private async readContent(target: string, config: ResolvedClientConfig): Promise<ClientContent | null> {
    const fields = ['d.name', 'd.base_path', 'd.directory', 'd.is_multi_file', 'd.completed_bytes', 'f.multicall'] as const;
    const results = await this.multicall(
      config,
      fields.map((methodName) => ({ methodName, params: methodName === 'f.multicall' ? [target, '', 'f.path='] : [target] })),
    );
    const fault = results.find((slot): slot is XmlRpcFault => slot instanceof XmlRpcFault);
    if (fault) {
      if (isUnknownHash(fault)) return null;
      throw new RtorrentRefusal(fields[results.indexOf(fault)], fault);
    }
    const [name, basePath, directory, multiFile, completedBytes, files] = results as XmlRpcValue[];

    // A magnet still fetching its metadata holds one empty placeholder, `<HASH>.meta`, and erase
    // leaves it behind like any other file.
    if (isMetaName(text(name), target)) {
      return { root: contentPath({ name, basePath, directory, multiFile: false }) ?? '', files: [], multiFile: false, expectOnDisk: false };
    }

    const isMulti = flag(multiFile);
    const relativeFiles =
      isMulti && Array.isArray(files) ? files.flatMap((row) => (Array.isArray(row) && typeof row[0] === 'string' && row[0] ? [row[0]] : [])) : [];
    return {
      root: contentPath({ name, basePath, directory, multiFile: isMulti }) ?? '',
      files: relativeFiles,
      multiFile: isMulti,
      expectOnDisk: count(completedBytes) > 0,
    };
  }

  async test(config: ResolvedClientConfig): Promise<DownloadClientTestResult> {
    try {
      // Through system.multicall on purpose: it is what every poll uses, so a test that passes
      // means polling will too.
      const [version] = await this.multicall(config, [{ methodName: 'system.client_version', params: [] }]);
      if (version instanceof XmlRpcFault) throw new RtorrentRefusal('system.client_version', version);
      return { success: true, version: typeof version === 'string' && version.trim() ? version.trim() : undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[download_client.test] [fail] clientId=${config.id} error="${sanitizeLogValue(message)}" - rTorrent connection test failed`);
      return { success: false, error: message };
    }
  }

  /** Torrents rTorrent holds, read in batches; a hash it does not hold is simply absent. */
  private async readTorrents(hashes: string[], config: ResolvedClientConfig): Promise<Map<string, TorrentRow>> {
    const rows = new Map<string, TorrentRow>();
    for (let start = 0; start < hashes.length; start += STATUS_BATCH) {
      const batch = hashes.slice(start, start + STATUS_BATCH);
      const calls = batch.flatMap((hash) => STATUS_FIELDS.map((field) => ({ methodName: field, params: [hash.toUpperCase()] })));
      const results = await this.multicall(config, calls);

      batch.forEach((hash, index) => {
        const slots = results.slice(index * STATUS_FIELDS.length, (index + 1) * STATUS_FIELDS.length);
        const fault = slots.find((slot): slot is XmlRpcFault => slot instanceof XmlRpcFault);
        if (fault) {
          if (isUnknownHash(fault)) return;
          throw new RtorrentRefusal(STATUS_FIELDS[slots.indexOf(fault)], fault);
        }
        rows.set(hash, Object.fromEntries(STATUS_FIELDS.map((field, position) => [field, slots[position] as XmlRpcValue])) as TorrentRow);
      });
    }
    return rows;
  }

  private async multicall(config: ResolvedClientConfig, calls: MulticallEntry[]): Promise<Array<XmlRpcValue | XmlRpcFault>> {
    const answer = await this.call(config, 'system.multicall', [calls.map((entry) => ({ methodName: entry.methodName, params: entry.params }))]);
    try {
      return decodeMulticallResults(answer, calls.length);
    } catch (error) {
      throw notXmlRpc(error);
    }
  }

  /** One HTTP request. Every call goes through here, so the address check is never skipped. */
  private async call(config: ResolvedClientConfig, method: string, params: XmlRpcParam[]): Promise<XmlRpcValue> {
    const url = await this.endpoint(config);
    let body: string;
    try {
      body = encodeMethodCall(method, params);
    } catch (error) {
      throw new BadRequestException(`rTorrent cannot be sent that ${method} call: ${error instanceof Error ? error.message : String(error)}`);
    }

    const response = await fetchClient(
      url,
      {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/xml', ...basicAuthHeader(config.username, config.password) },
      },
      LABEL,
    );
    if (!response.ok) throw transportError(response, method, Buffer.byteLength(body));

    const xml = await readClientText(response, LABEL);
    try {
      return decodeMethodResponse(xml);
    } catch (error) {
      if (error instanceof XmlRpcFault) throw new RtorrentRefusal(method, error);
      throw notXmlRpc(error);
    }
  }

  private async endpoint(config: ResolvedClientConfig): Promise<URL> {
    const url = await ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
    if (url.pathname === '' || url.pathname === '/') url.pathname = DEFAULT_RPC_PATH;
    return url;
  }
}

const ENDPOINT_HINT = 'The base URL must be the XML-RPC endpoint itself: usually /RPC2, or plugins/httprpc/action.php when ruTorrent is in front.';

/** A 404, a 401 and a 413 are fixed in three different places, so they must not read the same. */
function transportError(response: Response, method: string, bodyBytes: number): Error {
  if (response.status === 401 || response.status === 403) return new BadRequestException('rTorrent refused those credentials');
  if (response.status === 404) return new BadRequestException(`rTorrent answered 404 at that address. ${ENDPOINT_HINT}`);
  if (response.status === 413) {
    return new BadRequestException(
      `The web server in front of rTorrent refused a ${Math.ceil(bodyBytes / 1024)} KB request as too large. Raise its request body limit (client_max_body_size in nginx) and rTorrent's network.xmlrpc.size_limit.`,
    );
  }
  if (response.status >= 300 && response.status < 400) {
    return new BadRequestException(`rTorrent answered with a redirect (${response.status}), which is usually a login page. ${ENDPOINT_HINT}`);
  }
  throwForClientServerError(response, LABEL, method);
  return new BadRequestException(`rTorrent answered ${response.status} for ${method}`);
}

function notXmlRpc(error: unknown): Error {
  if (error instanceof XmlRpcMalformedError)
    return new BadRequestException(`Something answered at that address, but not rTorrent's XML-RPC. ${ENDPOINT_HINT}`);
  return error instanceof Error ? error : new BadRequestException(String(error));
}

/**
 * Both spellings seen in the wild: "Could not find info-hash." (0.9.x, xmlrpc-c) and
 * "invalid parameters: info-hash not found" (0.15 and later).
 */
function isUnknownMethod(fault: XmlRpcFault): boolean {
  return fault.code === -506 || /not defined/i.test(fault.reason);
}

function infoHash(value: XmlRpcValue | undefined): string | null {
  const hash = typeof value === 'string' ? value.toLowerCase() : '';
  return INFO_HASH.test(hash) ? hash : null;
}

function isUnknownHash(fault: XmlRpcFault): boolean {
  return /info-hash/i.test(fault.reason) && /could not find|not found/i.test(fault.reason);
}

function magnetNamesTracker(magnet: string): boolean {
  try {
    return new URL(magnet.trim()).searchParams.getAll('tr').some((tracker) => tracker.trim() !== '');
  } catch {
    return false;
  }
}

/**
 * One argument in rTorrent's command syntax, quoted: unquoted, a space or a comma in the value
 * splits it, and rTorrent drops the command without a word.
 */
function command(name: string, value: string): string {
  return `${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Whether a torrent's `custom1` names this label. ruTorrent stores labels URL-encoded and Flood
 * keeps several comma-separated, so either spelling of the same label counts as ours.
 */
function carriesLabel(custom1: XmlRpcValue | undefined, label: string): boolean {
  if (typeof custom1 !== 'string' || !custom1.trim()) return false;
  return custom1.split(',').some((part) => {
    const trimmed = part.trim();
    return trimmed === label || decodeLabel(trimmed) === label;
  });
}

function decodeLabel(value: string): string | null {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return null;
  }
}

/** A magnet waiting for its metadata is a placeholder named after its hash. */
function isMetaName(name: string, hash: string): boolean {
  return name.toUpperCase() === `${hash.toUpperCase()}.META`;
}

function toDownloadStatus(hash: string, row: TorrentRow): DownloadStatus {
  const name = text(row['d.name']);
  const meta = isMetaName(name, hash);
  const checking = flag(row['d.is_hash_checking']);
  const complete = flag(row['d.complete']);
  const started = flag(row['d.state']);
  const sizeBytes = count(row['d.size_bytes']);
  const completedBytes = count(row['d.completed_bytes']);
  const totalBytes = !meta && sizeBytes > 0 ? sizeBytes : null;
  const message = text(row['d.message']).trim();

  return {
    clientKey: hash,
    state: mapState({ meta, checking, complete, started, open: flag(row['d.is_open']), active: flag(row['d.is_active']) }),
    progressPercent: complete && !checking ? 100 : totalBytes ? Math.min(99, Math.floor((completedBytes / totalBytes) * 100)) : 0,
    downloadedBytes: meta ? 0 : completedBytes,
    totalBytes,
    contentPath: meta
      ? null
      : contentPath({ name: row['d.name'], basePath: row['d.base_path'], directory: row['d.directory'], multiFile: flag(row['d.is_multi_file']) }),
    seed: toSeedInfo(row, complete && started && flag(row['d.is_active']) && !checking),
    // rTorrent keeps the last tracker answer in the torrent's message. Whether it is a rejection
    // or a passing outage is the monitor's call, so every tracker message goes to it.
    ...(/^tracker:/i.test(message) ? { trackerError: message.slice(0, MESSAGE_LIMIT) } : {}),
  };
}

/**
 * Never `failed`: rTorrent reports a storage or load failure only in its own log and leaves the
 * torrent started but inactive, exactly as a pause looks. Calling that a failure would be a guess;
 * the stall watchdog is what settles a download that never moves again.
 *
 * A hash check comes before completion because `d.complete` stays 1 while a recheck runs and the
 * completed bytes fall back to what has been verified so far.
 *
 * Nor is complete always finished. rTorrent 0.9.8 answers for a moment after its completion check
 * with the torrent complete, started and not yet reopened, before its finished hooks have run: a
 * move on completion has not moved anything yet, so the path it reports is about to stop existing.
 * A paused torrent stays open, so only that moment reads as not yet done.
 */
function mapState(torrent: { meta: boolean; checking: boolean; complete: boolean; started: boolean; open: boolean; active: boolean }): DownloadState {
  if (torrent.checking) return 'queued';
  if (torrent.complete) return torrent.started && !torrent.open ? 'queued' : 'completed';
  if (torrent.meta) return 'queued';
  return torrent.started && torrent.open && torrent.active ? 'downloading' : 'queued';
}

/**
 * `d.base_path` is empty for a torrent that has never been opened, so the path is rebuilt from
 * the directory the way rTorrent itself lays it out: the directory is the content folder for a
 * multi-file torrent and the parent folder for a single file.
 */
function contentPath(torrent: { name: XmlRpcValue; basePath: XmlRpcValue; directory: XmlRpcValue; multiFile: boolean }): string | null {
  const basePath = text(torrent.basePath).trim();
  if (basePath) return basePath;
  const directory = text(torrent.directory).trim();
  if (!directory) return null;
  if (torrent.multiFile) return directory;
  const name = text(torrent.name);
  return name ? `${directory === '/' ? '' : directory.replace(/\/+$/, '')}/${name}` : null;
}

function toSeedInfo(row: TorrentRow, seeding: boolean): SeedInfo {
  const ratio = row['d.ratio'];
  const finishedAt = count(row['d.timestamp.finished']);
  const uploaded = row['d.up.total'];
  return {
    seeding,
    // Per mille.
    ratio: typeof ratio === 'number' && ratio >= 0 ? ratio / 1000 : null,
    // rTorrent enforces ratio through groups in its own config, never per torrent.
    ratioGoal: null,
    // rTorrent keeps no seeding clock. Time since it finished is only a seeding time while it is
    // still seeding: a torrent stopped last month did not seed through it.
    seedingTimeSeconds: seeding && finishedAt > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - finishedAt) : null,
    seedingTimeGoalMinutes: null,
    uploadedBytes: typeof uploaded === 'number' && uploaded >= 0 ? uploaded : null,
  };
}

function text(value: XmlRpcValue | XmlRpcFault | undefined): string {
  return typeof value === 'string' ? value : '';
}

function count(value: XmlRpcValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function flag(value: XmlRpcValue | undefined): boolean {
  return value === 1 || value === true || value === '1';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
