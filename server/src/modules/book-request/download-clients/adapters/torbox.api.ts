import { File } from 'node:buffer';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FormData } from 'undici';

import { ensureSafeUrl } from '../../../../common/utils/ssrf.utils';
import type { ResolvedClientConfig } from '../download-client-adapter';
import { endpointUrl, fetchClient, readClientText, throwForClientServerError } from './client-http.utils';

/** The one place the display name lives, so adapter messages and logs agree. */
export const TORBOX_LABEL = 'TorBox';

/**
 * How far a hash lookup pages through an account. A debrid account holds whatever its owner put
 * there, so the scan is bounded rather than assumed small: five pages bound the work, they do not
 * promise the item is inside them.
 */
const LIST_PAGE_SIZE = 1000;
const LIST_PAGE_LIMIT = 5;

export interface TorboxTorrentFile {
  fileId: number | null;
  name: string;
  size: number | null;
}

export interface TorboxTorrent {
  torrentId: number;
  hash: string | null;
  name: string | null;
  state: string | null;
  downloadFinished: boolean;
  downloadPresent: boolean;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  ratio: number | null;
  active: boolean;
  files: TorboxTorrentFile[];
}

export interface TorboxUser {
  email: string | null;
  plan: number | null;
}

/**
 * Thin REST client for one TorBox account.
 *
 * Every call answers with the same `{ success, detail, data }` envelope, so envelope handling,
 * bearer auth and the credential-refusal mapping live here once. The API key never appears in a
 * log line or an error message; it does travel in the CDN link query string, which is why those
 * links are fetched and forgotten rather than kept.
 */
@Injectable()
export class TorboxApiClient {
  async createTorrent(
    config: ResolvedClientConfig,
    release: { magnet?: string; torrentFile?: Buffer; torrentFileName?: string },
  ): Promise<{ torrentId: number | null; hash: string | null }> {
    const form = new FormData();
    if (release.magnet) form.append('magnet', release.magnet);
    if (release.torrentFile) {
      const bytes = new Uint8Array(new ArrayBuffer(release.torrentFile.byteLength));
      bytes.set(release.torrentFile);
      form.append('file', new File([bytes], release.torrentFileName ?? 'release.torrent', { type: 'application/x-bittorrent' }));
    }
    // TorBox zips multi-file releases by default, which would hand the import one archive it did
    // not ask for instead of the files the release names.
    form.append('allow_zip', 'false');

    const data = await this.call(config, 'createtorrent', '/v1/api/torrents/createtorrent', {
      method: 'POST',
      body: form as unknown as BodyInit,
    });
    const record = isRecord(data) ? data : {};
    return { torrentId: numericField(record.torrent_id), hash: stringField(record.hash)?.toLowerCase() ?? null };
  }

  /** Every wanted hash the account holds, found by paging `mylist` until the pages run out. */
  async findByHashes(config: ResolvedClientConfig, hashes: ReadonlySet<string>): Promise<Map<string, TorboxTorrent>> {
    const found = new Map<string, TorboxTorrent>();
    if (hashes.size === 0) return found;

    for (let page = 0; page < LIST_PAGE_LIMIT; page += 1) {
      const data = await this.call(
        config,
        'mylist',
        '/v1/api/torrents/mylist',
        { method: 'GET' },
        {
          offset: String(page * LIST_PAGE_SIZE),
          limit: String(LIST_PAGE_SIZE),
        },
      );
      const records = Array.isArray(data) ? data : [];
      for (const entry of records) {
        if (!isRecord(entry)) continue;
        const torrent = toTorboxTorrent(entry);
        if (torrent.hash !== null && hashes.has(torrent.hash)) found.set(torrent.hash, torrent);
      }
      if (records.length < LIST_PAGE_SIZE || found.size >= hashes.size) break;
    }

    return found;
  }

  async requestDownloadLink(config: ResolvedClientConfig, torrentId: number, fileId: number): Promise<string> {
    const data = await this.call(
      config,
      'requestdl',
      '/v1/api/torrents/requestdl',
      { method: 'GET' },
      { token: this.requireApiKey(config), torrent_id: String(torrentId), file_id: String(fileId) },
    );
    if (typeof data !== 'string' || data.trim() === '') {
      throw new BadRequestException('TorBox did not return a download link for that file');
    }
    return data;
  }

  async controlTorrent(config: ResolvedClientConfig, torrentId: number, operation: 'delete' | 'resume' | 'reannounce'): Promise<void> {
    await this.call(config, 'controltorrent', '/v1/api/torrents/controltorrent', {
      method: 'POST',
      body: JSON.stringify({ operation, torrent_id: torrentId }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getUser(config: ResolvedClientConfig): Promise<TorboxUser> {
    const data = await this.call(config, 'user/me', '/v1/api/user/me', { method: 'GET' });
    const record = isRecord(data) ? data : {};
    return { email: stringField(record.email), plan: numericField(record.plan) };
  }

  private requireApiKey(config: ResolvedClientConfig): string {
    const key = config.password?.trim();
    if (!key) throw new BadRequestException('TorBox needs an API key');
    return key;
  }

  private async call(
    config: ResolvedClientConfig,
    operation: string,
    path: string,
    init: RequestInit,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const apiKey = this.requireApiKey(config);
    const base = await ensureSafeUrl(config.baseUrl, { allowPrivate: config.allowPrivateAddress });
    // TorBox is a hosted service, never a LAN daemon, so a plain-http base URL can only be a way to
    // carry the API key in cleartext. Refuse it before the key reaches the URL or the headers.
    if (base.protocol !== 'https:') throw new BadRequestException('TorBox requires an https:// base URL');
    const target = endpointUrl(base, path);
    for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value);

    const response = await fetchClient(target, { ...init, headers: { Authorization: `Bearer ${apiKey}`, ...init.headers } }, TORBOX_LABEL, {
      allowPrivate: config.allowPrivateAddress,
      pinResolvedAddress: true,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new BadRequestException('TorBox rejected the API key');
      if (response.status === 429) {
        throw new ServiceUnavailableException('TorBox is rate limiting requests for this account; try again shortly');
      }
      throwForClientServerError(response, TORBOX_LABEL, operation);
      throw new BadRequestException(`TorBox answered ${response.status} for ${operation}`);
    }

    const envelope = await this.readEnvelope(response);
    if (isRecord(envelope) && envelope.success === false) {
      const detail = stringField(envelope.detail);
      if (detail !== null && /api[ _-]?key|access[ _-]?token/i.test(detail)) {
        throw new BadRequestException('TorBox rejected the API key');
      }
      throw new BadRequestException(detail === null ? `TorBox refused ${operation}` : `TorBox refused ${operation}: ${detail.slice(0, 200)}`);
    }

    return isRecord(envelope) && 'data' in envelope ? envelope.data : envelope;
  }

  /** Some control calls carry no body worth reading, so an empty answer is valid here. */
  private async readEnvelope(response: Response): Promise<unknown> {
    const text = await readClientText(response, TORBOX_LABEL);
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new BadRequestException('TorBox answered with something that is not JSON');
    }
  }
}

export function toTorboxTorrent(record: Record<string, unknown>): TorboxTorrent {
  const totalBytes = byteSizeOf(record.size);
  const progress = progressPercent(record.progress);

  return {
    torrentId: numericField(record.id) ?? 0,
    hash: stringField(record.hash)?.toLowerCase() ?? null,
    name: stringField(record.name),
    state: stringField(record.download_state),
    // The documented completion signal; `download_state === "completed"` is explicitly not one.
    downloadFinished: record.download_finished === true,
    downloadPresent: record.download_present !== false,
    progressPercent: progress,
    downloadedBytes: totalBytes === null ? 0 : Math.round((totalBytes * progress) / 100),
    totalBytes,
    ratio: numericField(record.ratio),
    active: record.active === true,
    files: toTorboxFiles(record.files),
  };
}

function toTorboxFiles(value: unknown): TorboxTorrentFile[] {
  if (!Array.isArray(value)) return [];

  const files: TorboxTorrentFile[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    files.push({
      fileId: numericField(entry.id),
      name: stringField(entry.name) ?? stringField(entry.short_name) ?? stringField(entry.s3_path) ?? 'file',
      size: byteSizeOf(entry.size),
    });
  }
  return files;
}

/** `progress` is a fraction when it stays within one and a percentage otherwise; both appear. */
function progressPercent(value: unknown): number {
  const raw = numericField(value);
  if (raw === null) return 0;
  const percent = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numericField(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function byteSizeOf(value: unknown): number | null {
  const parsed = numericField(value);
  if (parsed === null || parsed < 0) return null;
  return Math.round(parsed);
}
