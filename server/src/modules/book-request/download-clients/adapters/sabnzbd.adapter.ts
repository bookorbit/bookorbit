import { File } from 'node:buffer';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DownloadClientTestResult } from '@bookorbit/types';
import { FormData } from 'undici';

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
import { endpointUrl, fetchClient, readClientJson, throwForClientServerError } from './client-http.utils';

const LABEL = 'SABnzbd';
const OWNERSHIP_PREFIX = 'bookorbit-';
const INVENTORY_LIMIT = 1000;
const API_RESULT_LIMIT = INVENTORY_LIMIT + 1;
const MEBIBYTE = 1024 * 1024;

interface SabSlot {
  nzo_id?: unknown;
  filename?: unknown;
  name?: unknown;
  nzb_name?: unknown;
  status?: unknown;
  cat?: unknown;
  category?: unknown;
  storage?: unknown;
  percentage?: unknown;
  bytes?: unknown;
  bytesleft?: unknown;
  mb?: unknown;
  mbleft?: unknown;
  fail_message?: unknown;
}

interface LocatedSlot {
  slot: SabSlot;
  location: 'queue' | 'history';
}

@Injectable()
export class SabnzbdAdapter implements DownloadClientAdapter {
  readonly type = 'sabnzbd' as const;
  readonly label = LABEL;
  readonly delivers = 'usenet' as const;

  private readonly logger = new Logger(SabnzbdAdapter.name);

  async add(release: GrabPayload, config: ResolvedClientConfig): Promise<{ clientKey: string }> {
    if (!release.nzbFile?.length) throw new BadRequestException('A SABnzbd grab needs an NZB file');
    const key = normalizeKey(release.clientKey);
    await this.requireCategory(config);
    // A failed history entry is not an in-flight job. SABnzbd keeps one until somebody clears its
    // history, and the client key is a stable digest, so adopting it would fail every later grab of
    // the same release before an NZB was ever sent.
    const owned = (await this.findOwned(config)).get(key);
    if (owned && toStatus(key, owned).state !== 'failed') return { clientKey: key };

    const filename = safeNzbName(release.nzbFileName);
    const nzbBytes = new Uint8Array(new ArrayBuffer(release.nzbFile.byteLength));
    nzbBytes.set(release.nzbFile);
    const form = new FormData();
    form.append('name', new File([nzbBytes], filename, { type: 'application/x-nzb' }));

    const result = await this.call(
      config,
      'addfile',
      { cat: config.category, nzbname: ownedName(config.id, key, filename) },
      {
        method: 'POST',
        body: form as unknown as BodyInit,
      },
    );
    const ids = result.nzo_ids ?? result.nzo_id;
    if (!validNzoIds(ids)) throw new BadRequestException('SABnzbd accepted no download id for that NZB');
    return { clientKey: key };
  }

  async status(keys: string[], config: ResolvedClientConfig): Promise<DownloadStatus[]> {
    if (keys.length === 0) return [];
    const wanted = new Set(keys.map(normalizeKey));
    const found = await this.findOwned(config);
    return [...wanted].flatMap((key) => {
      const located = found.get(key);
      return located ? [toStatus(key, located)] : [];
    });
  }

  async listOwned(config: ResolvedClientConfig): Promise<OwnedDownloadClientInventory> {
    const found = await this.findOwned(config);
    const items = [...found.entries()];
    return {
      supported: true,
      truncated: items.length > INVENTORY_LIMIT,
      items: items.slice(0, INVENTORY_LIMIT).map(([key, located]) => ({
        ...toStatus(key, located),
        name: displayName(located.slot, config.id) ?? stringField(located.slot.nzo_id) ?? key,
      })),
    };
  }

  async remove(key: string, config: ResolvedClientConfig, opts: { deleteFiles: boolean }): Promise<void> {
    const normalized = normalizeKey(key);
    const located = (await this.findOwned(config)).get(normalized);
    if (!located) return;
    const id = stringField(located.slot.nzo_id);
    if (!id) throw new BadRequestException('SABnzbd returned an invalid download id');

    const result = await this.call(config, located.location, {
      name: 'delete',
      value: id,
      del_files: opts.deleteFiles ? '1' : '0',
      ...(located.location === 'history' ? { archive: '0' } : {}),
    });
    if (result.status !== true) throw new BadRequestException('SABnzbd refused to remove that download');
  }

  async test(config: ResolvedClientConfig): Promise<DownloadClientTestResult> {
    const startedAt = Date.now();
    try {
      const result = await this.call(config, 'version');
      const version = stringField(result.version);
      if (!version) return { success: false, error: 'SABnzbd returned an invalid version' };
      await this.requireCategory(config);
      return { success: true, version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[download_client.test] [fail] clientId=${config.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.constructor.name : 'Error'} error="${sanitizeLogValue(message)}" - SABnzbd connection test failed`,
      );
      return { success: false, error: message };
    }
  }

  private async findOwned(config: ResolvedClientConfig): Promise<Map<string, LocatedSlot>> {
    const [queue, history] = await Promise.all([this.slots(config, 'queue'), this.slots(config, 'history')]);
    const found = new Map<string, LocatedSlot>();
    for (const slot of history) addOwned(found, slot, 'history', config);
    for (const slot of queue) addOwned(found, slot, 'queue', config);
    return found;
  }

  private async requireCategory(config: ResolvedClientConfig): Promise<void> {
    const result = await this.call(config, 'get_config', { section: 'categories' });
    const root = result.config;
    const categories = root && typeof root === 'object' && !Array.isArray(root) ? (root as Record<string, unknown>).categories : null;
    const exists =
      Array.isArray(categories) &&
      categories.some(
        (category) =>
          category &&
          typeof category === 'object' &&
          !Array.isArray(category) &&
          stringField((category as Record<string, unknown>).name) === config.category,
      );
    if (!exists) throw new BadRequestException(`SABnzbd category "${config.category}" does not exist`);
  }

  private async slots(config: ResolvedClientConfig, location: LocatedSlot['location']): Promise<SabSlot[]> {
    const result = await this.call(config, location, {
      start: '0',
      limit: String(API_RESULT_LIMIT),
    });
    const container = result[location];
    if (!container || typeof container !== 'object' || Array.isArray(container)) {
      throw new BadRequestException(`SABnzbd returned an invalid ${location} response`);
    }
    const slots = (container as Record<string, unknown>).slots;
    if (!Array.isArray(slots) || slots.some((slot) => slot === null || typeof slot !== 'object' || Array.isArray(slot))) {
      throw new BadRequestException(`SABnzbd returned an invalid ${location} listing`);
    }
    return slots as SabSlot[];
  }

  private async call(
    config: ResolvedClientConfig,
    mode: string,
    params: Record<string, string> = {},
    init: RequestInit = { method: 'GET' },
  ): Promise<Record<string, unknown>> {
    const base = await ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
    const target = endpointUrl(base, '/api');
    target.searchParams.set('mode', mode);
    target.searchParams.set('output', 'json');
    target.searchParams.set('apikey', requireApiKey(config));
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);

    const response = await fetchClient(target, init, LABEL, { allowPrivate: config.allowPrivateAddress, pinResolvedAddress: true });
    if (!response.ok) {
      throwForClientServerError(response, LABEL, mode);
      if (response.status === 401 || response.status === 403) throw new BadRequestException('SABnzbd rejected the API key');
      throw new BadRequestException(`SABnzbd answered ${response.status} for ${mode}`);
    }

    const result = await readClientJson<unknown>(response, LABEL);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new BadRequestException('SABnzbd returned an invalid API response');
    const record = result as Record<string, unknown>;
    if (record.status === false) {
      const detail = stringField(record.error);
      if (detail?.toLowerCase().includes('api key')) throw new BadRequestException('SABnzbd rejected the API key');
      throw new BadRequestException(detail ? `SABnzbd refused ${mode}: ${detail.slice(0, 200)}` : `SABnzbd refused ${mode}`);
    }
    return record;
  }
}

function addOwned(found: Map<string, LocatedSlot>, slot: SabSlot, location: LocatedSlot['location'], config: ResolvedClientConfig): void {
  const key = ownedClientKey(slot, config.id);
  const category = stringField(location === 'queue' ? slot.cat : slot.category);
  if (!key || category !== config.category) return;
  found.set(key, { slot, location });
}

function toStatus(key: string, located: LocatedSlot): DownloadStatus {
  const { slot, location } = located;
  const state = location === 'history' ? historyState(stringField(slot.status)) : queueState(stringField(slot.status));
  const totalBytes = byteCount(slot.bytes) ?? mibCount(slot.mb);
  const remainingBytes = byteCount(slot.bytesleft) ?? mibCount(slot.mbleft) ?? 0;
  const downloadedBytes = state === 'completed' ? (totalBytes ?? 0) : Math.max(0, (totalBytes ?? 0) - remainingBytes);
  const reportedPercent = numericField(slot.percentage);
  const progressPercent =
    state === 'completed'
      ? 100
      : reportedPercent !== null
        ? clampPercent(reportedPercent)
        : totalBytes && totalBytes > 0
          ? clampPercent((downloadedBytes / totalBytes) * 100)
          : 0;
  const failure = stringField(slot.fail_message);
  return {
    clientKey: key,
    state,
    progressPercent,
    downloadedBytes,
    totalBytes,
    contentPath: state === 'completed' ? (stringField(slot.storage) ?? null) : null,
    ...(state === 'failed' ? { errorMessage: failure || `SABnzbd finished with status ${stringField(slot.status) ?? 'unknown'}` } : {}),
  };
}

function queueState(value: string | null): DownloadState {
  const status = value?.toUpperCase();
  if (status === 'FAILED') return 'failed';
  if (status && ['PAUSED', 'QUEUED', 'IDLE', 'PROPAGATING', 'FETCHING', 'GRABBING'].includes(status)) return 'queued';
  if (status) return 'downloading';
  return 'unknown';
}

function historyState(value: string | null): DownloadState {
  const status = value?.toUpperCase();
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED' || status === 'ABORTED') return 'failed';
  if (status) return 'downloading';
  return 'unknown';
}

function ownedName(clientId: number, key: string, filename: string): string {
  const stem = filename.toLowerCase().endsWith('.nzb') ? filename.slice(0, -4) : filename;
  const prefix = ownedPrefix(clientId, key);
  return `${prefix}${stem}`.slice(0, 500);
}

function ownedClientKey(slot: SabSlot, clientId: number): string | null {
  const prefix = `${OWNERSHIP_PREFIX}${clientId}-`;
  for (const value of [slot.filename, slot.name, slot.nzb_name]) {
    const name = stringField(value);
    if (!name?.startsWith(prefix)) continue;
    const match = name.slice(prefix.length).match(/^([a-f0-9]{40,64})-/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

function displayName(slot: SabSlot, clientId: number): string | null {
  const key = ownedClientKey(slot, clientId);
  if (!key) return null;
  const prefix = ownedPrefix(clientId, key);
  for (const value of [slot.filename, slot.name, slot.nzb_name]) {
    const name = stringField(value);
    if (name?.startsWith(prefix) && name.length > prefix.length) return name.slice(prefix.length);
  }
  return null;
}

function ownedPrefix(clientId: number, key: string): string {
  return `${OWNERSHIP_PREFIX}${clientId}-${key}-`;
}

function requireApiKey(config: ResolvedClientConfig): string {
  if (!config.password) throw new BadRequestException('SABnzbd needs an API key');
  return config.password;
}

function validNzoIds(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim().length > 0;
  return Array.isArray(value) && value.some((id) => (typeof id === 'string' || typeof id === 'number') && String(id).trim().length > 0);
}

function stringField(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numericField(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function byteCount(value: unknown): number | null {
  const parsed = numericField(value);
  if (parsed === null) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(parsed));
}

function mibCount(value: unknown): number | null {
  const parsed = numericField(value);
  if (parsed === null) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(parsed * MEBIBYTE));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
