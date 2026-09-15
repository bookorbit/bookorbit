import { BadGatewayException, Injectable } from '@nestjs/common';
import { MAX_INDEXER_SEED_TIME_MINUTES } from '@bookorbit/types';
import type { NetworkProfile } from '@bookorbit/types';

import { readBoundedText, ResponseTooLargeError } from '../../../common/utils/bounded-response';
import { safeFetch } from '../../../common/utils/safe-fetch';
import { ensureSafeUrl } from '../../../common/utils/ssrf.utils';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_INDEXERS = 500;
const MAX_TEXT_LENGTH = 500;
const MAX_REDIRECTS = 3;

export interface ProwlarrConnection {
  baseUrl: string;
  apiKey: string;
  allowPrivateAddress: boolean;
  networkProfile: NetworkProfile | null;
}

export interface ProwlarrIndexer {
  id: number;
  name: string;
  implementation: string | null;
  protocol: 'torrent' | 'usenet';
  enabled: boolean;
  priority: number | null;
  seedRatioGoal: number | null;
  seedTimeMinutes: number | null;
}

@Injectable()
export class ProwlarrClient {
  async status(connection: ProwlarrConnection): Promise<{ version: string | null }> {
    const payload = await this.getJson(connection, '/api/v1/system/status');
    if (!isRecord(payload)) throw new BadGatewayException('Prowlarr returned an invalid status response');
    return { version: boundedText(payload.version) };
  }

  async indexers(connection: ProwlarrConnection): Promise<ProwlarrIndexer[]> {
    const payload = await this.getJson(connection, '/api/v1/indexer');
    if (!Array.isArray(payload)) throw new BadGatewayException('Prowlarr returned an invalid indexer list');
    if (payload.length > MAX_INDEXERS) throw new BadGatewayException(`Prowlarr returned more than ${MAX_INDEXERS} indexers`);

    const rows: ProwlarrIndexer[] = [];
    for (const value of payload) {
      if (!isRecord(value)) continue;
      const id = finiteInteger(value.id);
      const name = boundedText(value.name);
      const protocol = typeof value.protocol === 'string' ? value.protocol.toLowerCase() : '';
      if (id === null || id <= 0 || !name || (protocol !== 'torrent' && protocol !== 'usenet')) continue;
      const fields = Array.isArray(value.fields) ? value.fields : [];
      rows.push({
        id,
        name,
        implementation: boundedText(value.implementation ?? value.implementationName ?? value.definitionName),
        protocol,
        enabled: value.enable === true,
        priority: finiteInteger(value.priority),
        seedRatioGoal: protocol === 'torrent' ? positiveFiniteNumber(fieldValue(fields, 'torrentBaseSettings.seedRatio')) : null,
        seedTimeMinutes: protocol === 'torrent' ? seedTimeMinutes(fieldValue(fields, 'torrentBaseSettings.seedTime')) : null,
      });
    }
    return rows;
  }

  private async getJson(connection: ProwlarrConnection, path: string): Promise<unknown> {
    try {
      const base = await ensureSafeUrl(connection.baseUrl, { allowPrivate: connection.allowPrivateAddress });
      let current = endpoint(base, path);
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await safeFetch(
          current.href,
          { signal, redirect: 'manual', headers: { Accept: 'application/json', 'X-Api-Key': connection.apiKey } },
          {
            allowPrivate: connection.allowPrivateAddress,
            profile: connection.networkProfile,
            pinResolvedAddress: true,
          },
        );

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          void response.body?.cancel().catch(() => undefined);
          if (!location) throw new BadGatewayException(`Prowlarr answered ${response.status} without a redirect location`);
          const redirected = await ensureSafeUrl(new URL(location, current).href, { allowPrivate: connection.allowPrivateAddress });
          if (redirected.origin !== base.origin) throw new BadGatewayException('Prowlarr redirected its API to a different host');
          current = redirected;
          continue;
        }

        if (response.status === 401 || response.status === 403) throw new BadGatewayException('Prowlarr rejected the API key');
        if (!response.ok) throw new BadGatewayException(`Prowlarr answered ${response.status}`);

        try {
          return JSON.parse(await readBoundedText(response, MAX_JSON_BYTES));
        } catch (error) {
          if (error instanceof ResponseTooLargeError) throw new BadGatewayException('Prowlarr returned more data than BookOrbit will read');
          if (error instanceof SyntaxError) throw new BadGatewayException('Prowlarr returned invalid JSON');
          throw error;
        }
      }
      throw new BadGatewayException(`Prowlarr redirected more than ${MAX_REDIRECTS} times`);
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new BadGatewayException('Prowlarr did not answer in time');
      }
      throw new BadGatewayException(`Could not reach Prowlarr: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function endpoint(base: URL, path: string): URL {
  const target = new URL(base.href);
  const prefix = base.pathname.replace(/\/+$/, '');
  target.pathname = `${prefix}${path}`;
  target.search = '';
  target.hash = '';
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= MAX_TEXT_LENGTH ? text : null;
}

function finiteInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function fieldValue(fields: unknown[], name: string): unknown {
  for (const field of fields) {
    if (isRecord(field) && field.name === name) return field.value;
  }
  return null;
}

function positiveFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveFiniteNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Prowlarr's seed time lands in an `integer` column, and the whole synchronization runs in one
 * transaction: a single out-of-range value from the remote would otherwise overflow the insert and
 * discard every other discovered indexer with it.
 */
function seedTimeMinutes(value: unknown): number | null {
  const parsed = positiveInteger(value);
  return parsed !== null && parsed <= MAX_INDEXER_SEED_TIME_MINUTES ? parsed : null;
}
