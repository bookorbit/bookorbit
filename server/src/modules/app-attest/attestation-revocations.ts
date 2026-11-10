import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizeSerial } from './android-key-verifier';

export const ANDROID_ATTESTATION_STATUS_URL = 'https://android.googleapis.com/attestation/status';

const REFRESH_MS = 24 * 60 * 60_000;
const RETRY_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 16 * 1024 * 1024;

interface StatusList {
  entries?: Record<string, { status?: string }>;
}

/**
 * Google's list of revoked and suspended attestation certificates, asked for at most once a day.
 * A server that cannot reach it keeps the last list it had, and lets a registration through on it:
 * failing closed would refuse every Android phone on a server with no internet.
 */
@Injectable()
export class AttestationRevocations {
  private readonly logger = new Logger(AttestationRevocations.name);
  private revoked = new Set<string>();
  private nextRefreshAt = 0;
  private pending: Promise<void> | null = null;

  async anyRevoked(serials: readonly string[], now = Date.now()): Promise<boolean> {
    if (serials.length === 0) return false;
    if (now >= this.nextRefreshAt) await (this.pending ??= this.refresh(now).finally(() => (this.pending = null)));
    return serials.some((serial) => this.revoked.has(normalizeSerial(serial)));
  }

  private async refresh(now: number): Promise<void> {
    const startedAt = Date.now();
    try {
      const response = await fetch(ANDROID_ATTESTATION_STATUS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`status list answered ${response.status}`);
      if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('status list is too large');
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error('status list is too large');
      const list = JSON.parse(text) as StatusList;
      if (!list.entries || typeof list.entries !== 'object') throw new Error('status list has no entries');
      this.revoked = new Set(
        Object.entries(list.entries)
          .filter(([, entry]) => entry?.status === 'REVOKED' || entry?.status === 'SUSPENDED')
          .map(([serial]) => normalizeSerial(serial)),
      );
      this.nextRefreshAt = now + REFRESH_MS;
      this.logger.debug(`[app-attest.revocations] [end] entries=${this.revoked.size} durationMs=${Date.now() - startedAt} - status list refreshed`);
    } catch (error) {
      this.nextRefreshAt = now + RETRY_MS;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `[app-attest.revocations] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - status list unavailable, using the last one`,
      );
    }
  }
}
