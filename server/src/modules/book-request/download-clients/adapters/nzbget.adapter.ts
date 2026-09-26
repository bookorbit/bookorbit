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
} from '../download-client-adapter';
import { basicAuthHeader, endpointUrl, fetchClient, readClientJson, throwForClientServerError } from './client-http.utils';

const LABEL = 'NZBGet';
const OWNERSHIP_PREFIX = 'bookorbit:';
const RECONCILIATION_LIMIT = 1000;

interface RpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string } | string | null;
}

interface NzbGetItem {
  NZBID?: number;
  NZBName?: string;
  Name?: string;
  Category?: string;
  DupeKey?: string;
  Status?: string;
  DestDir?: string;
  FinalDir?: string;
  FileSizeHi?: number;
  FileSizeLo?: number;
  RemainingSizeHi?: number;
  RemainingSizeLo?: number;
  DownloadedSizeHi?: number;
  DownloadedSizeLo?: number;
}

interface LocatedItem {
  item: NzbGetItem;
  location: 'queue' | 'history';
}

@Injectable()
export class NzbgetAdapter implements DownloadClientAdapter {
  readonly type = 'nzbget' as const;
  readonly label = LABEL;
  readonly delivers = 'usenet' as const;

  private readonly logger = new Logger(NzbgetAdapter.name);

  async add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientKey: string }> {
    if (!release.nzbFile?.length) throw new BadRequestException('An NZBGet grab needs an NZB file');
    const dupeKey = ownedKey(config.id, release.clientKey);
    if (await this.findByDupeKeys(new Set([release.clientKey]), config)) return { clientKey: release.clientKey };

    const filename = safeNzbName(release.nzbFileName);
    // The v16 signature remains accepted by current NZBGet and also works before v25 added
    // AutoCategory as an extra parameter. The explicit category above means we do not need it.
    const id = await this.rpc<number>(config, 'append', [
      filename,
      release.nzbFile.toString('base64'),
      config.category,
      0,
      false,
      false,
      dupeKey,
      0,
      'ALL',
      [],
    ]);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('NZBGet refused that NZB');
    return { clientKey: release.clientKey };
  }

  async status(keys: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]> {
    const wanted = new Set(keys.map(normalizeKey));
    const found = await this.findByDupeKeys(wanted, config);
    if (!found) return [];
    return [...found.values()].map(({ item, location }) => toStatus(item, location, config.id));
  }

  async listOwned(config: ResolvedClientConfig): Promise<OwnedDownloadClientInventory> {
    const [queue, history] = await Promise.all([this.listGroups(config), this.history(config)]);
    const byKey = new Map<string, LocatedItem>();
    for (const item of history) addOwned(byKey, item, 'history', config.category, config.id);
    for (const item of queue) addOwned(byKey, item, 'queue', config.category, config.id);
    const items = [...byKey.values()];
    return {
      supported: true,
      truncated: items.length > RECONCILIATION_LIMIT,
      items: items.slice(0, RECONCILIATION_LIMIT).map(({ item, location }) => ({
        ...toStatus(item, location, config.id),
        name: item.NZBName?.trim() || item.Name?.trim() || clientKey(item.DupeKey, config.id) || String(item.NZBID ?? ''),
      })),
    };
  }

  async remove(key: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void> {
    const found = await this.findByDupeKeys(new Set([normalizeKey(key)]), config);
    const located = found?.get(normalizeKey(key));
    if (!located) return;
    const id = located.item.NZBID;
    if (!Number.isInteger(id)) throw new BadRequestException('NZBGet returned an invalid queue id');
    const command =
      located.location === 'queue'
        ? opts.deleteFiles
          ? 'GroupFinalDelete'
          : 'GroupParkDelete'
        : opts.deleteFiles
          ? 'HistoryFinalDelete'
          : 'HistoryDelete';
    const removed = await this.rpc<boolean>(config, 'editqueue', [command, '', [id]]);
    if (!removed) throw new BadRequestException('NZBGet refused to remove that download');
  }

  async test(config: ResolvedClientConfig): Promise<DownloadClientTestResult> {
    const startedAt = Date.now();
    try {
      const version = await this.rpc<string>(config, 'version', []);
      if (typeof version !== 'string' || !version.trim()) return { success: false, error: 'NZBGet returned an invalid version' };
      return { success: true, version: version.trim() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.test] [fail] clientId=${config.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.constructor.name : 'Error'} error="${sanitizeLogValue(message)}" - NZBGet connection test failed`,
      );
      return { success: false, error: message };
    }
  }

  private async findByDupeKeys(wanted: Set<string>, config: ResolvedClientConfig): Promise<Map<string, LocatedItem> | null> {
    if (wanted.size === 0) return new Map();
    const found = new Map<string, LocatedItem>();
    for (const item of await this.listGroups(config)) collectWanted(found, item, 'queue', wanted, config.id);
    if (found.size < wanted.size) {
      for (const item of await this.history(config)) collectWanted(found, item, 'history', wanted, config.id);
    }
    return found.size > 0 ? found : null;
  }

  private listGroups(config: ResolvedClientConfig): Promise<NzbGetItem[]> {
    return this.rpcItems(config, 'listgroups', [0]);
  }

  private history(config: ResolvedClientConfig): Promise<NzbGetItem[]> {
    return this.rpcItems(config, 'history', [false]);
  }

  private async rpcItems(config: ResolvedClientConfig, method: string, params: unknown[]): Promise<NzbGetItem[]> {
    const result = await this.rpc<unknown>(config, method, params);
    if (!Array.isArray(result) || result.some((item) => item === null || typeof item !== 'object')) {
      throw new BadRequestException(`NZBGet returned an invalid ${method} result`);
    }
    return result as NzbGetItem[];
  }

  private async rpc<T>(config: ResolvedClientConfig, method: string, params: unknown[]): Promise<T> {
    const base = await ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
    const response = await fetchClient(
      endpointUrl(base, '/jsonrpc'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...basicAuthHeader(config.username, config.password) },
        body: JSON.stringify({ method, params }),
      },
      LABEL,
      { allowPrivate: config.allowPrivateAddress, pinResolvedAddress: true },
    );
    if (!response.ok) {
      throwForClientServerError(response, LABEL, method);
      if (response.status === 401 || response.status === 403) throw new BadRequestException('NZBGet rejected the username or password');
      throw new BadRequestException(`NZBGet answered ${response.status} for ${method}`);
    }
    const envelope = await readClientJson<RpcEnvelope<T>>(response, LABEL);
    if (!envelope || typeof envelope !== 'object') throw new BadRequestException('NZBGet returned an invalid JSON-RPC response');
    if (envelope.error) {
      const detail = typeof envelope.error === 'string' ? envelope.error : envelope.error.message;
      throw new BadRequestException(detail ? `NZBGet refused ${method}: ${detail}` : `NZBGet refused ${method}`);
    }
    if (!Object.prototype.hasOwnProperty.call(envelope, 'result')) throw new BadRequestException('NZBGet returned no JSON-RPC result');
    return envelope.result as T;
  }
}

function collectWanted(
  found: Map<string, LocatedItem>,
  item: NzbGetItem,
  location: LocatedItem['location'],
  wanted: Set<string>,
  clientId: number,
): void {
  const key = clientKey(item.DupeKey, clientId);
  if (key && wanted.has(key) && !found.has(key)) found.set(key, { item, location });
}

function addOwned(found: Map<string, LocatedItem>, item: NzbGetItem, location: LocatedItem['location'], category: string, clientId: number): void {
  const key = clientKey(item.DupeKey, clientId);
  if (!key || item.Category !== category) return;
  found.set(key, { item, location });
}

function toStatus(item: NzbGetItem, location: LocatedItem['location'], clientId: number): DownloadStatus {
  const key = clientKey(item.DupeKey, clientId);
  if (!key) throw new BadRequestException('NZBGet returned an invalid BookOrbit duplicate key');
  const totalBytes = uint64(item.FileSizeHi, item.FileSizeLo);
  const remainingBytes = uint64(item.RemainingSizeHi, item.RemainingSizeLo) ?? 0;
  const downloadedBytes = uint64(item.DownloadedSizeHi, item.DownloadedSizeLo) ?? Math.max(0, (totalBytes ?? 0) - remainingBytes);
  const state = location === 'history' ? historyState(item.Status) : queueState(item.Status);
  const path = item.FinalDir?.trim() || item.DestDir?.trim() || null;
  return {
    clientKey: key,
    state,
    progressPercent: state === 'completed' ? 100 : totalBytes && totalBytes > 0 ? clampPercent((downloadedBytes / totalBytes) * 100) : 0,
    downloadedBytes,
    totalBytes,
    contentPath: state === 'completed' ? path : null,
    ...(state === 'failed' ? { errorMessage: `NZBGet finished with status ${item.Status ?? 'unknown'}` } : {}),
  };
}

function queueState(status: string | undefined): DownloadState {
  if (status === 'PP_FINISHED') return 'completed';
  if (status === 'QUEUED' || status === 'PAUSED' || status === 'PP_QUEUED') return 'queued';
  if (status) return 'downloading';
  return 'unknown';
}

function historyState(status: string | undefined): DownloadState {
  if (status?.startsWith('SUCCESS/') || status === 'WARNING/SCRIPT') return 'completed';
  if (status?.startsWith('FAILURE/') || status?.startsWith('DELETED/') || status?.startsWith('WARNING/')) return 'failed';
  return 'unknown';
}

function uint64(hi: number | undefined, lo: number | undefined): number | null {
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
  const value = (hi! >>> 0) * 0x1_0000_0000 + (lo! >>> 0);
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ownedKey(clientId: number, key: string): string {
  return `${OWNERSHIP_PREFIX}${clientId}:${normalizeKey(key)}`;
}

function clientKey(value: string | undefined, clientId: number | null): string | null {
  if (clientId === null) return null;
  const prefix = `${OWNERSHIP_PREFIX}${clientId}:`;
  if (!value?.startsWith(prefix)) return null;
  const key = value.slice(prefix.length).toLowerCase();
  return /^[a-f0-9]{40,64}$/.test(key) ? key : null;
}

function normalizeKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(key)) throw new BadRequestException('Invalid client key');
  return key;
}

function safeNzbName(value: string | undefined): string {
  const base =
    value
      ?.trim()
      .split(/[\\/]/)
      .pop()
      ?.replace(/[^a-z0-9._ -]/gi, '_') || 'bookorbit.nzb';
  const stem = base.toLowerCase().endsWith('.nzb') ? base.slice(0, -4) : base;
  return `${stem.slice(0, 496)}.nzb`;
}
