import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import {
  AI_HEADER_MAX_COUNT,
  AI_RESERVED_HEADER_NAMES,
  isAiApiType,
  type AiApiType,
  type AiConnection,
  type AiConnectionHeaderInput,
  type AiConnectionStatus,
  type AiFailureCode,
  type AiJsonSupport,
  type CreateAiConnectionRequest,
  type NetworkProfile,
  type UpdateAiConnectionRequest,
} from '@bookorbit/types';

import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiConnectionRow, AiStoredHeader, NewAiConnectionRow } from '../../db/schema';
import { AiError } from './ai-client.types';
import { AiConnectionRepository } from './ai-connection.repository';
import { AI_EVENTS, AiEventsService, type AiConnectionFailingEvent } from './ai-events.service';
import { AiLedgerRepository, type AiConnectionMonthTotals } from './ai-ledger.repository';
import { aiMonthKey } from './ai-month';
import { AiSecretsService, type AiHeaderSecret } from './ai-secrets.service';
import { normaliseAiBaseUrl } from './ai-url';

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const KEY_UNREADABLE_REASON = "Saved key can't be read; enter it again";
const UNSUPPORTED_REASON = 'This server does not know this API type';

/** Fields of a connection whose change makes an earlier test say nothing about it. */
const REACH_FIELDS = ['apiType', 'baseUrl', 'key', 'headers', 'networkProfile'] as const;

/** Everything needed to send a request, secrets included. Never leaves the server. */
export interface ResolvedAiConnection {
  id: number | null;
  name: string;
  apiType: AiApiType;
  baseUrl: string;
  key: string | null;
  headers: AiHeaderSecret[];
  networkProfile: NetworkProfile | null;
  timeoutMs: number;
  maxParallel: number;
  requestsPerMinute: number | null;
  /** How the last passing test found JSON works, for slots on `auto`. */
  jsonSupport: AiJsonSupport | null;
}

export interface AiConnectionChanges {
  fields: string[];
  key: 'replaced' | 'removed' | null;
}

@Injectable()
export class AiConnectionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiConnectionService.name);

  constructor(
    private readonly repo: AiConnectionRepository,
    private readonly ledger: AiLedgerRepository,
    private readonly secrets: AiSecretsService,
    private readonly events: AiEventsService,
  ) {}

  /** A changed or removed env key shows up as failing connections, rather than as a job failing later. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const row of await this.repo.list()) {
        if (this.unreadable(row) && row.failingCode !== 'key-unreadable') {
          await this.markFailing(row.id, 'key-unreadable', KEY_UNREADABLE_REASON);
        }
      }
    } catch (err) {
      this.logger.warn(
        `[ai.connection.check_keys] [fail] error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - key check skipped`,
      );
    }
  }

  async list(): Promise<AiConnection[]> {
    const [rows, totals] = await Promise.all([this.repo.list(), this.ledger.connectionMonthTotals(aiMonthKey())]);
    return rows.map((row) => this.toResponse(row, totals.get(row.id)));
  }

  async getRow(id: number): Promise<AiConnectionRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('AI connection not found');
    return row;
  }

  async get(id: number): Promise<AiConnection> {
    const row = await this.getRow(id);
    const totals = await this.ledger.connectionMonthTotals(aiMonthKey());
    return this.toResponse(row, totals.get(id));
  }

  isEncryptionConfigured(): boolean {
    return this.secrets.isConfigured();
  }

  async create(request: CreateAiConnectionRequest): Promise<AiConnectionRow> {
    const headers = this.mergeHeaders(request.headers ?? [], []);
    const key = request.key ? request.key : null;
    const values: NewAiConnectionRow = {
      name: request.name.trim(),
      apiType: request.apiType,
      baseUrl: normaliseAiBaseUrl(request.baseUrl, request.apiType),
      keyEncrypted: key ? this.secrets.encrypt(key) : null,
      keyHint: key ? AiSecretsService.hint(key) || null : null,
      headers: headers.map((header) => ({ name: header.name, hint: AiSecretsService.hint(header.value) || null })),
      headersEncrypted: this.secrets.sealHeaders(headers),
      networkProfile: request.networkProfile ?? null,
      timeoutMs: request.timeoutMs,
      maxParallel: request.maxParallel,
      requestsPerMinute: request.requestsPerMinute ?? null,
    };
    try {
      return await this.repo.insert(values);
    } catch (err) {
      throw this.nameTaken(err);
    }
  }

  async update(id: number, request: UpdateAiConnectionRequest): Promise<{ row: AiConnectionRow; changes: AiConnectionChanges }> {
    const current = await this.getRow(id);
    const values: Partial<NewAiConnectionRow> = {};
    const fields: string[] = [];
    let keyChange: AiConnectionChanges['key'] = null;

    if (request.name !== undefined && request.name.trim() !== current.name) {
      values.name = request.name.trim();
      fields.push('name');
    }
    const apiType = request.apiType ?? current.apiType;
    if (request.apiType !== undefined && request.apiType !== current.apiType) {
      values.apiType = request.apiType;
      fields.push('apiType');
    }
    if (request.baseUrl !== undefined || values.apiType !== undefined) {
      const baseUrl = normaliseAiBaseUrl(request.baseUrl ?? current.baseUrl, isAiApiType(apiType) ? apiType : 'openai-chat');
      if (baseUrl !== current.baseUrl) {
        values.baseUrl = baseUrl;
        fields.push('baseUrl');
      }
    }
    if (request.key === null || request.key === '') {
      if (current.keyEncrypted) {
        values.keyEncrypted = null;
        values.keyHint = null;
        keyChange = 'removed';
        fields.push('key');
      }
    } else if (request.key !== undefined) {
      values.keyEncrypted = this.secrets.encrypt(request.key);
      values.keyHint = AiSecretsService.hint(request.key) || null;
      keyChange = 'replaced';
      fields.push('key');
    }
    if (request.headers !== undefined) {
      const stored = request.headers.some((header) => header.value === undefined) ? this.storedHeaders(current) : [];
      const headers = this.mergeHeaders(request.headers, stored);
      values.headers = headers.map((header): AiStoredHeader => ({ name: header.name, hint: AiSecretsService.hint(header.value) || null }));
      values.headersEncrypted = this.secrets.sealHeaders(headers);
      fields.push('headers');
    }
    if (request.networkProfile !== undefined) {
      values.networkProfile = request.networkProfile ?? null;
      fields.push('networkProfile');
    }
    if (request.timeoutMs !== undefined && request.timeoutMs !== current.timeoutMs) {
      values.timeoutMs = request.timeoutMs;
      fields.push('timeoutMs');
    }
    if (request.maxParallel !== undefined && request.maxParallel !== current.maxParallel) {
      values.maxParallel = request.maxParallel;
      fields.push('maxParallel');
    }
    if (request.requestsPerMinute !== undefined && request.requestsPerMinute !== current.requestsPerMinute) {
      values.requestsPerMinute = request.requestsPerMinute;
      fields.push('requestsPerMinute');
    }

    if (fields.some((field) => (REACH_FIELDS as readonly string[]).includes(field))) {
      // An earlier test or failure was about the old settings. The card shows Not tested until
      // the next test, and requests may try the new settings.
      values.lastTest = null;
      values.failingSince = null;
      values.failingCode = null;
      values.failingReason = null;
    }

    if (fields.length === 0) return { row: current, changes: { fields, key: null } };
    try {
      const row = await this.repo.update(id, values);
      if (!row) throw new NotFoundException('AI connection not found');
      return { row, changes: { fields, key: keyChange } };
    } catch (err) {
      throw this.nameTaken(err);
    }
  }

  async remove(id: number): Promise<AiConnectionRow> {
    const row = await this.getRow(id);
    await this.repo.delete(id);
    return row;
  }

  /**
   * Everything a request through this connection needs. A key that no longer decrypts marks the
   * connection failing and throws `provider-auth`, so jobs pause for the admin instead of failing.
   */
  async resolve(id: number): Promise<ResolvedAiConnection> {
    const row = await this.repo.findById(id);
    if (!row) throw new AiError('slot-empty', 'The connection this slot used no longer exists', { connectionId: id });
    return this.resolveRow(row);
  }

  async resolveRow(row: AiConnectionRow): Promise<ResolvedAiConnection> {
    if (!isAiApiType(row.apiType)) {
      throw new AiError('provider-auth', UNSUPPORTED_REASON, { connectionId: row.id, failure: 'unsupported-api-type' });
    }
    const key = row.keyEncrypted ? this.secrets.decrypt(row.keyEncrypted) : null;
    const headers = this.secrets.openHeaders(row.headersEncrypted);
    if ((row.keyEncrypted && key === null) || headers === null) {
      await this.markFailing(row.id, 'key-unreadable', KEY_UNREADABLE_REASON);
      throw new AiError('provider-auth', KEY_UNREADABLE_REASON, { connectionId: row.id, failure: 'key-unreadable' });
    }
    return {
      id: row.id,
      name: row.name,
      apiType: row.apiType,
      baseUrl: row.baseUrl,
      key,
      headers,
      networkProfile: row.networkProfile ?? null,
      timeoutMs: row.timeoutMs,
      maxParallel: row.maxParallel,
      requestsPerMinute: row.requestsPerMinute,
      jsonSupport: row.lastTest?.jsonSupport ?? null,
    };
  }

  /**
   * An unsaved connection from the dialog. Editing a saved one sends no key or header value it did
   * not change, so those come from the saved row.
   */
  async resolveDraft(request: CreateAiConnectionRequest & { connectionId?: number }): Promise<ResolvedAiConnection> {
    const saved = request.connectionId !== undefined ? await this.getRow(request.connectionId) : null;
    const savedResolved = saved ? await this.resolveRow(saved).catch(() => null) : null;
    const key = request.key === undefined ? (savedResolved?.key ?? null) : request.key || null;
    const headers = this.mergeHeaders(request.headers ?? [], savedResolved?.headers ?? [], { requireEncryption: false });
    return {
      id: saved?.id ?? null,
      name: request.name,
      apiType: request.apiType,
      baseUrl: normaliseAiBaseUrl(request.baseUrl, request.apiType),
      key,
      headers,
      networkProfile: request.networkProfile ?? null,
      timeoutMs: request.timeoutMs ?? saved?.timeoutMs ?? 120_000,
      maxParallel: request.maxParallel ?? saved?.maxParallel ?? 8,
      requestsPerMinute: request.requestsPerMinute ?? saved?.requestsPerMinute ?? null,
      jsonSupport: null,
    };
  }

  async markFailing(id: number, code: AiFailureCode, reason: string): Promise<void> {
    await this.repo.setFailing(id, code, reason, new Date());
    this.events.emit(AI_EVENTS.CONNECTION_FAILING, { connectionId: id, code } satisfies AiConnectionFailingEvent);
  }

  async markHealthy(id: number): Promise<void> {
    await this.repo.clearFailing(id);
    this.events.emit(AI_EVENTS.CONNECTION_HEALTHY, { connectionId: id });
  }

  /** Stored secrets of a connection, for removing them from anything a provider sends back. */
  static secretsOf(connection: Pick<ResolvedAiConnection, 'key' | 'headers'>): string[] {
    return [connection.key, ...connection.headers.map((header) => header.value)].filter((value): value is string => Boolean(value));
  }

  toResponse(row: AiConnectionRow, totals?: AiConnectionMonthTotals): AiConnection {
    const usable = isAiApiType(row.apiType);
    const unreadable = this.unreadable(row);
    let status: AiConnectionStatus = row.lastTest?.ok ? 'working' : 'untested';
    let failingCode = row.failingCode ?? null;
    let failingReason = row.failingReason ?? null;
    let failingSince = row.failingSince?.toISOString() ?? null;
    if (!usable) {
      failingCode = 'unsupported-api-type';
      failingReason = UNSUPPORTED_REASON;
    } else if (unreadable) {
      failingCode = 'key-unreadable';
      failingReason = KEY_UNREADABLE_REASON;
    }
    if (!usable || unreadable || row.failingSince) {
      status = 'failing';
      failingSince ??= row.updatedAt.toISOString();
    }

    return {
      id: row.id,
      name: row.name,
      apiType: row.apiType,
      usable,
      baseUrl: row.baseUrl,
      hasKey: row.keyEncrypted !== null,
      keyHint: row.keyHint ?? null,
      headers: (row.headers ?? []).map((header) => ({ name: header.name, hasValue: true, valueHint: header.hint ?? null })),
      networkProfile: row.networkProfile ?? null,
      timeoutMs: row.timeoutMs,
      maxParallel: row.maxParallel,
      requestsPerMinute: row.requestsPerMinute,
      status,
      lastTest: row.lastTest ?? null,
      failingSince: status === 'failing' ? failingSince : null,
      failingCode: status === 'failing' ? failingCode : null,
      failingReason: status === 'failing' ? failingReason : null,
      month: { requests: totals?.requests ?? 0, costMicros: totals?.costMicros ?? 0 },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private unreadable(row: AiConnectionRow): boolean {
    if (row.keyEncrypted && this.secrets.decrypt(row.keyEncrypted) === null) return true;
    return this.secrets.openHeaders(row.headersEncrypted) === null;
  }

  private storedHeaders(row: AiConnectionRow): AiHeaderSecret[] {
    const headers = this.secrets.openHeaders(row.headersEncrypted);
    if (headers === null) {
      throw new BadRequestException({ message: "Saved header values can't be read; enter them again", errorCode: 'AI_ENCRYPTION_KEY_MISSING' });
    }
    return headers;
  }

  /**
   * The headers to store: each name once, none that would override what the API type sends, and
   * a value for each, either typed now or kept from the saved connection.
   */
  private mergeHeaders(input: AiConnectionHeaderInput[], stored: AiHeaderSecret[], options = { requireEncryption: true }): AiHeaderSecret[] {
    if (input.length > AI_HEADER_MAX_COUNT) throw new BadRequestException(`At most ${AI_HEADER_MAX_COUNT} extra headers`);
    const seen = new Set<string>();
    const merged: AiHeaderSecret[] = [];
    for (const header of input) {
      const name = header.name.trim();
      const lower = name.toLowerCase();
      if (!HEADER_NAME_RE.test(name)) throw new BadRequestException(`'${name}' is not a valid header name`);
      if ((AI_RESERVED_HEADER_NAMES as readonly string[]).includes(lower)) {
        throw new BadRequestException(`'${name}' is set by the API type and cannot be overridden`);
      }
      if (seen.has(lower)) throw new BadRequestException(`Header '${name}' is listed twice`);
      seen.add(lower);
      const value = header.value ?? stored.find((entry) => entry.name.toLowerCase() === lower)?.value;
      if (value === undefined || value === '') throw new BadRequestException(`Header '${name}' needs a value`);
      merged.push({ name, value });
    }
    if (options.requireEncryption && merged.length > 0 && !this.secrets.isConfigured()) {
      // Reuses the refusal message, so the page shows the same banner as for a key.
      this.secrets.encrypt('');
    }
    return merged;
  }

  private nameTaken(err: unknown): unknown {
    if (isUniqueViolation(err)) {
      return new ConflictException({ message: 'A connection with this name already exists', errorCode: 'AI_CONNECTION_NAME_TAKEN' });
    }
    return err;
  }
}
