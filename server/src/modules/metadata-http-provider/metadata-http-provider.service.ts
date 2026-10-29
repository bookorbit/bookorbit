import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  BUILT_IN_METADATA_PROVIDER_LABELS,
  isBuiltInMetadataProviderKey,
  isExternalMetadataProviderKeySyntax,
  isMovedMetadataProviderKey,
  METADATA_HTTP_PROVIDER_TIMEOUT_MS,
  type ExternalMetadataProviderKey,
  type MetadataHttpProviderInfo,
  type MetadataHttpProviderStatus,
  type MetadataHttpProviderTestResult,
  type MetadataHttpProviderView,
} from '@bookorbit/types';

import type { MetadataHttpProviderRow, NewMetadataHttpProviderRow } from '../../db/schema';
import { PrivateAddressException, RemoteHostResolutionException } from '../../common/utils/ssrf.utils';
import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PROVIDER_ID_MAX_LENGTHS } from '../../common/utils/provider-id.utils';
import { HttpProviderClient, HttpProviderError, type HttpProviderTarget } from './http-provider.client';
import { distinctProviderLabels, FALLBACK_SPEC_VERSION, fallbackProviderInfo, parseProviderInfo } from './http-provider-info';
import { MetadataHttpProviderCatalog, providerIconUrl, type ActiveHttpProvider, type RegisteredHttpProvider } from './metadata-http-provider.catalog';
import { MetadataHttpProviderRepository, type PurgeCounts } from './metadata-http-provider.repository';
import { MetadataHttpProviderSecrets } from './metadata-http-provider-secrets.service';
import type { CreateMetadataHttpProviderDto, UpdateMetadataHttpProviderDto } from './dto/metadata-http-provider.dto';

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UNREACHABLE_AFTER_FAILURES = 3;
const DEFAULT_TEST_QUERY = 'Frankenstein';
const MAX_ERROR_LENGTH = 300;
const MOVED_PROVIDER_ID_MAX_LENGTHS = { lubimyczytac: PROVIDER_ID_MAX_LENGTHS.lubimyczytacId, aladin: PROVIDER_ID_MAX_LENGTHS.aladinId } as const;
/** Until a provider has said otherwise, BookOrbit asks it one thing at a time. */
const UNKNOWN_RATE_LIMIT = { maxConcurrency: 1, minIntervalMs: 0 };

type InfoOutcome = { ok: true; info: MetadataHttpProviderInfo } | { ok: false; error: string; status: MetadataHttpProviderStatus };

interface InfoOptions {
  /** For a row registered without `/provider/info`: the key it keeps when it still has none. */
  pinnedFallbackKey?: string;
  /** For an address not yet accepted: without info, it must answer `/search` to count as a provider. */
  verifySearch?: boolean;
}

const NOT_A_PROVIDER = Symbol('not a provider');

/**
 * Registers, checks and refreshes external metadata providers, and keeps the catalog that searches
 * read in step with the table. It never searches for books itself; that is the metadata-fetch
 * module's adapter, reading the same catalog.
 */
@Injectable()
export class MetadataHttpProviderService implements OnModuleInit {
  private readonly logger = new Logger(MetadataHttpProviderService.name);

  constructor(
    private readonly repository: MetadataHttpProviderRepository,
    private readonly client: HttpProviderClient,
    private readonly catalog: MetadataHttpProviderCatalog,
    private readonly secrets: MetadataHttpProviderSecrets,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async list(): Promise<MetadataHttpProviderView[]> {
    return (await this.repository.findAll()).map((row) => this.toView(row));
  }

  async create(dto: CreateMetadataHttpProviderDto, userId: number | null): Promise<MetadataHttpProviderView> {
    const startedAt = Date.now();
    const baseUrl = normalizeBaseUrl(dto.baseUrl);
    const authorization = normalizeAuthorization(dto.authorization);
    const target: HttpProviderTarget = {
      key: `new:${baseUrl}`,
      baseUrl,
      authorization,
      allowPrivateAddress: dto.allowPrivateAddress ?? false,
      timeoutMs: dto.timeoutMs ?? METADATA_HTTP_PROVIDER_TIMEOUT_MS.default,
      rateLimit: UNKNOWN_RATE_LIMIT,
    };
    this.logger.log(`[http_provider.create] [start] host="${sanitizeLogValue(new URL(baseUrl).host)}" - registering provider`);

    let info: MetadataHttpProviderInfo;
    try {
      info = await this.requireInfo(target, { verifySearch: true });
    } finally {
      // The limiter for an address being tried is never used again under this key.
      this.client.forget(target.key);
    }
    if (await this.repository.findByKey(info.key)) throw keyTaken(info.key);

    let row: MetadataHttpProviderRow;
    try {
      row = await this.repository.insert({
        key: info.key,
        baseUrl,
        authorizationEnc: authorization ? this.secrets.encrypt(authorization) : null,
        enabled: false,
        allowPrivateAddress: target.allowPrivateAddress,
        timeoutMs: target.timeoutMs,
        info,
        infoFetchedAt: new Date(),
        status: 'ok',
        consecutiveFailures: 0,
        lastError: null,
        createdBy: userId,
      });
    } catch (error) {
      // Two registrations of one provider at once: the second loses the race on the unique key.
      if (isUniqueViolation(error)) throw keyTaken(info.key);
      throw error;
    }
    await this.syncIcon(row, target, info);
    await this.reload();
    this.logger.log(
      `[http_provider.create] [end] id=${row.id} provider=${row.key} version="${sanitizeLogValue(info.version ?? '')}" durationMs=${Date.now() - startedAt} - provider registered disabled`,
    );
    return this.toView(row);
  }

  async update(id: number, dto: UpdateMetadataHttpProviderDto): Promise<MetadataHttpProviderView> {
    const row = await this.requireRow(id);
    const baseUrl = dto.baseUrl !== undefined ? normalizeBaseUrl(dto.baseUrl) : row.baseUrl;
    const allowPrivateAddress = dto.allowPrivateAddress ?? row.allowPrivateAddress;
    const timeoutMs = dto.timeoutMs ?? row.timeoutMs;
    const authorization = dto.authorization !== undefined ? normalizeAuthorization(dto.authorization) : this.storedAuthorization(row);

    const patch: Partial<NewMetadataHttpProviderRow> = { baseUrl, allowPrivateAddress, timeoutMs };
    if (dto.authorization !== undefined) patch.authorizationEnc = authorization ? this.secrets.encrypt(authorization) : null;

    const connectionChanged =
      baseUrl !== row.baseUrl || allowPrivateAddress !== row.allowPrivateAddress || dto.authorization !== undefined || timeoutMs !== row.timeoutMs;
    let refreshedInfo: MetadataHttpProviderInfo | null = null;
    const target = this.targetFor(row, { baseUrl, allowPrivateAddress, timeoutMs, authorization });
    if (connectionChanged) {
      const info = await this.requireInfo(target, {
        pinnedFallbackKey: fallbackKeyOf(row),
        verifySearch: baseUrl !== row.baseUrl,
      });
      if (info.key !== row.key) {
        throw new BadRequestException({
          message: `That address serves the provider "${info.key}", not "${row.key}". Add it as a new provider instead.`,
          errorCode: 'METADATA_PROVIDER_KEY_CHANGED',
          errorMeta: { expected: row.key, actual: info.key },
        });
      }
      Object.assign(patch, { info, infoFetchedAt: new Date(), status: 'ok', consecutiveFailures: 0, lastError: null });
      refreshedInfo = info;
    }

    if (dto.enabled !== undefined) {
      const status = (patch.status ?? row.status) as MetadataHttpProviderStatus;
      if (dto.enabled && (!(patch.info ?? row.info) || (status !== 'ok' && status !== 'stale'))) {
        throw new BadRequestException({
          message: 'Run a successful test before enabling this provider',
          errorCode: 'METADATA_PROVIDER_NOT_READY',
        });
      }
      // A header that no longer decrypts would leave the provider enabled but never asked.
      if (dto.enabled && patch.authorizationEnc === undefined && this.authorizationUnreadable(row)) {
        throw new BadRequestException({
          message: 'The saved authorization header could not be decrypted. Enter it again before enabling this provider.',
          errorCode: 'METADATA_PROVIDER_AUTHORIZATION_UNREADABLE',
        });
      }
      patch.enabled = dto.enabled;
    }

    const updated = await this.repository.update(id, patch);
    if (!updated) throw new NotFoundException(`Metadata provider ${id} not found`);
    if (refreshedInfo) await this.syncIcon(updated, target, refreshedInfo);
    this.client.forget(row.key);
    await this.reload();
    this.logger.log(
      `[http_provider.update] [end] id=${id} provider=${row.key} enabled=${updated.enabled} connectionChanged=${connectionChanged} - provider updated`,
    );
    return this.toView(updated);
  }

  /** A provider's stored icon, for the image route every signed-in user can read. */
  findIcon(key: string): Promise<{ contentType: string; hash: string; data: Buffer } | null> {
    return this.repository.findIconByKey(key);
  }

  async remove(id: number, purge: boolean): Promise<{ purged: PurgeCounts | null }> {
    const row = await this.requireRow(id);
    const purged = await this.repository.delete(id, purge ? row.key : null);
    this.client.forget(row.key);
    await this.reload();
    this.logger.log(
      `[http_provider.delete] [end] id=${id} provider=${row.key} purge=${purge} ids=${purged?.providerIds ?? 0} ratings=${purged?.ratings ?? 0} cache=${purged?.cacheEntries ?? 0} - provider removed`,
    );
    return { purged };
  }

  async test(id: number, query?: string): Promise<MetadataHttpProviderTestResult> {
    const row = await this.requireRow(id);
    const startedAt = Date.now();
    if (this.authorizationUnreadable(row)) {
      return {
        ok: false,
        name: row.info?.name ?? null,
        version: row.info?.version ?? null,
        latencyMs: 0,
        resultCount: null,
        sampleTitle: null,
        error: 'the saved authorization header could not be decrypted; BOOK_REQUEST_ENCRYPTION_KEY may have changed. Enter the header again.',
      };
    }
    const target = this.targetFor(row);
    const outcome = await this.fetchInfo(target, { pinnedFallbackKey: fallbackKeyOf(row) });
    if (!outcome.ok) {
      await this.recordOutcome(row, outcome);
      return {
        ok: false,
        name: row.info?.name ?? null,
        version: row.info?.version ?? null,
        latencyMs: Date.now() - startedAt,
        resultCount: null,
        sampleTitle: null,
        error: outcome.error,
      };
    }
    const written = await this.recordOutcome(row, outcome, false);
    if (written && outcome.info.key === row.key) await this.syncIcon(row, target, outcome.info);
    await this.reload();
    if (outcome.info.key !== row.key) {
      return {
        ok: false,
        name: outcome.info.name,
        version: outcome.info.version,
        latencyMs: Date.now() - startedAt,
        resultCount: null,
        sampleTitle: null,
        error: `the provider now reports the key "${outcome.info.key}" instead of "${row.key}"`,
      };
    }

    const params = new URLSearchParams({ query: query?.trim() || DEFAULT_TEST_QUERY, mediaType: 'book' });
    if (outcome.info.searchParams.includes('limit')) params.set('limit', '5');
    try {
      const matches = matchesOf(await this.client.search({ ...target, rateLimit: outcome.info.rateLimit }, params));
      if (!matches) throw new HttpProviderError('failed', 'search answer has no matches list');
      const first = matches[0] as { title?: unknown } | undefined;
      return {
        ok: true,
        name: outcome.info.name,
        version: outcome.info.version,
        latencyMs: Date.now() - startedAt,
        resultCount: matches.length,
        sampleTitle: typeof first?.title === 'string' ? first.title.slice(0, 200) : null,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        name: outcome.info.name,
        version: outcome.info.version,
        latencyMs: Date.now() - startedAt,
        resultCount: null,
        sampleTitle: null,
        error: `search failed: ${describeError(error)}`,
      };
    }
  }

  /** Re-reads every enabled provider's info, so version bumps, key changes and outages are noticed. */
  @Interval(REFRESH_INTERVAL_MS)
  async refreshAll(): Promise<void> {
    // A provider whose header no longer decrypts is out of searches already, and asking it without
    // the header would only record a refusal that is not the provider's fault.
    const rows = (await this.repository.findAll()).filter((row) => row.enabled && !this.authorizationUnreadable(row));
    if (rows.length === 0) return;
    const startedAt = Date.now();
    this.logger.log(`[http_provider.refresh] [start] providers=${rows.length} - refreshing provider info`);
    let failed = 0;
    for (const row of rows) {
      const target = this.targetFor(row);
      const outcome = await this.fetchInfo(target, { pinnedFallbackKey: fallbackKeyOf(row) });
      if (!outcome.ok || outcome.info.key !== row.key) failed++;
      const written = await this.recordOutcome(row, outcome, false);
      // A provider may change its icon without changing anything else, so it is checked every time.
      if (written && outcome.ok && outcome.info.key === row.key) await this.syncIcon(row, target, outcome.info);
    }
    await this.reload();
    this.logger.log(
      `[http_provider.refresh] [end] providers=${rows.length} failed=${failed} durationMs=${Date.now() - startedAt} - provider info refreshed`,
    );
  }

  /** Stores what a check of the provider found. False when the row changed meanwhile and the result was dropped. */
  private async recordOutcome(row: MetadataHttpProviderRow, outcome: InfoOutcome, reload = true): Promise<boolean> {
    let patch: Partial<NewMetadataHttpProviderRow>;
    if (outcome.ok && outcome.info.key !== row.key) {
      patch = { status: 'key_changed', lastError: `the provider now reports the key "${outcome.info.key}"`, infoFetchedAt: new Date() };
    } else if (outcome.ok) {
      patch = { info: outcome.info, infoFetchedAt: new Date(), status: 'ok', consecutiveFailures: 0, lastError: null };
    } else {
      const failures = row.consecutiveFailures + 1;
      const status: MetadataHttpProviderStatus =
        outcome.status === 'incompatible' ? 'incompatible' : failures >= UNREACHABLE_AFTER_FAILURES || !row.info ? 'unreachable' : 'stale';
      patch = { status, consecutiveFailures: failures, lastError: outcome.error.slice(0, MAX_ERROR_LENGTH) };
      this.logger.warn(
        `[http_provider.info] [fail] provider=${row.key} failures=${failures} status=${status} error="${sanitizeLogValue(outcome.error)}" - provider info refresh failed`,
      );
    }
    // The outcome describes the address the row had when it was read; an edit since then wins.
    if (!(await this.repository.updateIfConnectionUnchanged(row, patch))) return false;
    if (reload) await this.reload();
    return true;
  }

  /**
   * Keeps BookOrbit's copy of the provider's icon in step with its `avatarUrl`. A provider that
   * drops the URL loses the icon; one whose icon cannot be fetched keeps the one it had, since an
   * outage is no reason to lose it. Never fails the operation that asked.
   */
  private async syncIcon(
    row: Pick<MetadataHttpProviderRow, 'id' | 'key'>,
    target: HttpProviderTarget,
    info: MetadataHttpProviderInfo,
  ): Promise<void> {
    if (!info.avatarUrl) {
      await this.repository.deleteIcon(row.id);
      return;
    }
    const startedAt = Date.now();
    try {
      const { data, contentType } = await this.client.getIcon(target, info.avatarUrl);
      const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
      const known = (await this.repository.findIconVersions()).get(row.id);
      if (known?.hash === hash && known.sourceUrl === info.avatarUrl) return;
      await this.repository.saveIcon(row.id, { sourceUrl: info.avatarUrl, contentType, hash, data });
      this.logger.log(
        `[http_provider.icon] [end] provider=${row.key} contentType=${contentType} bytes=${data.length} durationMs=${Date.now() - startedAt} - provider icon stored`,
      );
    } catch (error) {
      this.logger.warn(
        `[http_provider.icon] [fail] provider=${row.key} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Unknown'} error="${sanitizeLogValue(describeError(error))}" - provider icon not stored`,
      );
    }
  }

  private async requireInfo(target: HttpProviderTarget, options: InfoOptions = {}): Promise<MetadataHttpProviderInfo> {
    const outcome = await this.fetchInfo(target, options);
    if (outcome.ok) return outcome.info;
    throw new BadRequestException({ message: outcome.error, errorCode: errorCodeFor(outcome) });
  }

  private async fetchInfo(target: HttpProviderTarget, options: InfoOptions = {}): Promise<InfoOutcome & { code?: string }> {
    try {
      const raw = await this.readInfo(target, options);
      if (raw === NOT_A_PROVIDER) {
        return { ok: false, error: 'nothing at this address answers /provider/info or /search like a metadata provider', status: 'incompatible' };
      }
      const parsed = parseProviderInfo(raw);
      if (!parsed.ok) return { ok: false, error: parsed.error, status: 'incompatible' };
      if (isBuiltInMetadataProviderKey(parsed.info.key)) {
        return { ok: false, error: `"${parsed.info.key}" is a built-in provider's key`, status: 'incompatible' };
      }
      // A source that moved out keeps its book_metadata column, so its ids must still fit it.
      if (isMovedMetadataProviderKey(parsed.info.key) && parsed.info.idMaxLength > MOVED_PROVIDER_ID_MAX_LENGTHS[parsed.info.key]) {
        const max = MOVED_PROVIDER_ID_MAX_LENGTHS[parsed.info.key];
        return {
          ok: false,
          error: `"${parsed.info.key}" ids are stored in ${max} characters; set idMaxLength to ${max} or less`,
          status: 'incompatible',
        };
      }
      return parsed;
    } catch (error) {
      if (error instanceof PrivateAddressException) {
        return {
          ok: false,
          error: 'the address is private; turn on "Allow private address" to reach a provider on your network',
          status: 'unreachable',
          code: 'METADATA_PROVIDER_PRIVATE_ADDRESS',
        };
      }
      if (error instanceof HttpProviderError && error.kind === 'unauthorized') {
        return {
          ok: false,
          error: `the provider refused the credentials (${error.status})`,
          status: 'unreachable',
          code: 'METADATA_PROVIDER_UNAUTHORIZED',
        };
      }
      if (error instanceof HttpProviderError && error.message.includes('not JSON')) {
        return { ok: false, error: 'the address answered, but not with provider info', status: 'incompatible' };
      }
      return { ok: false, error: describeError(error), status: 'unreachable', code: 'METADATA_PROVIDER_UNREACHABLE' };
    }
  }

  /**
   * The spec's first version had no `/provider/info`, and providers written for Audiobookshelf
   * still lack it. Such a provider is search-only and is named after its address, which the spec
   * asks v1 clients to accept. Any web server answers 404 for an unknown path, so a new address
   * without info must at least answer `/search` with a matches list.
   */
  private async readInfo(target: HttpProviderTarget, options: InfoOptions): Promise<unknown> {
    try {
      return await this.client.getInfo(target);
    } catch (error) {
      if (!(error instanceof HttpProviderError) || error.status !== 404) throw error;
      if (options.verifySearch && !(await this.answersSearch(target))) return NOT_A_PROVIDER;
      return fallbackProviderInfo(target.baseUrl, options.pinnedFallbackKey);
    }
  }

  private async answersSearch(target: HttpProviderTarget): Promise<boolean> {
    try {
      return matchesOf(await this.client.search(target, new URLSearchParams({ query: DEFAULT_TEST_QUERY, mediaType: 'book' }))) !== null;
    } catch (error) {
      // A 404 or an answer that is not JSON means nothing is there; a 5xx or a timeout is an outage.
      if (error instanceof HttpProviderError && error.kind === 'failed' && (error.status ?? 0) < 500) return false;
      throw error;
    }
  }

  /** Rebuilds the catalog from the table. Called after every change and at boot. */
  private async reload(): Promise<void> {
    const rows = (await this.repository.findAll()).filter((row) => isExternalMetadataProviderKeySyntax(row.key));
    const icons = await this.repository.findIconVersions();
    const labels = distinctProviderLabels(
      rows.map((row) => ({ key: row.key, name: row.info?.name ?? row.key, baseUrl: row.baseUrl })),
      [...Object.values(BUILT_IN_METADATA_PROVIDER_LABELS), ...Object.keys(BUILT_IN_METADATA_PROVIDER_LABELS)],
    );
    const registered: RegisteredHttpProvider[] = [];
    const active: ActiveHttpProvider[] = [];
    // Defence in depth: the filter above keeps any key a built-in or a pseudo-provider owns out.
    for (const row of rows) {
      const authorization = this.storedAuthorization(row);
      const entry: RegisteredHttpProvider = {
        id: row.id,
        key: row.key as ExternalMetadataProviderKey,
        label: labels.get(row.key) ?? row.key,
        enabled: row.enabled,
        status: row.status,
        info: row.info ?? null,
        authorizationUnreadable: row.authorizationEnc !== null && authorization === null,
        iconUrl: icons.has(row.id) ? providerIconUrl(row.key, icons.get(row.id)!.hash) : null,
        color: row.info?.color ?? null,
      };
      registered.push(entry);
      if (!row.enabled || !row.info || (row.status !== 'ok' && row.status !== 'stale') || entry.authorizationUnreadable) continue;
      active.push({ ...entry, info: row.info, target: this.targetFor(row, { authorization }) });
    }
    this.catalog.replace(registered, active);
  }

  private storedAuthorization(row: MetadataHttpProviderRow): string | null {
    return row.authorizationEnc ? this.secrets.decrypt(row.authorizationEnc, row.key) : null;
  }

  /** A header was saved, but the encryption key it was saved with is gone or changed. */
  private authorizationUnreadable(row: MetadataHttpProviderRow): boolean {
    return row.authorizationEnc !== null && this.storedAuthorization(row) === null;
  }

  private targetFor(
    row: MetadataHttpProviderRow,
    overrides: Partial<Pick<HttpProviderTarget, 'baseUrl' | 'allowPrivateAddress' | 'timeoutMs' | 'authorization'>> = {},
  ): HttpProviderTarget {
    return {
      key: row.key,
      baseUrl: overrides.baseUrl ?? row.baseUrl,
      allowPrivateAddress: overrides.allowPrivateAddress ?? row.allowPrivateAddress,
      timeoutMs: overrides.timeoutMs ?? row.timeoutMs,
      authorization: overrides.authorization !== undefined ? overrides.authorization : this.storedAuthorization(row),
      rateLimit: row.info?.rateLimit ?? UNKNOWN_RATE_LIMIT,
    };
  }

  private async requireRow(id: number): Promise<MetadataHttpProviderRow> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException(`Metadata provider ${id} not found`);
    return row;
  }

  private toView(row: MetadataHttpProviderRow): MetadataHttpProviderView {
    return {
      id: row.id,
      key: row.key as ExternalMetadataProviderKey,
      baseUrl: row.baseUrl,
      hasAuthorization: row.authorizationEnc !== null,
      authorizationUnreadable: this.authorizationUnreadable(row),
      enabled: row.enabled,
      allowPrivateAddress: row.allowPrivateAddress,
      timeoutMs: row.timeoutMs,
      status: row.status,
      lastError: row.lastError,
      info: row.info ?? null,
      // The catalog is rebuilt after every change, so it always has the current icon version.
      iconUrl: this.catalog.findRegistered(row.key)?.iconUrl ?? null,
      infoFetchedAt: row.infoFetchedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** The key a provider registered without `/provider/info` keeps, whatever its address becomes. */
function fallbackKeyOf(row: MetadataHttpProviderRow): string | undefined {
  return row.info?.specVersion === FALLBACK_SPEC_VERSION ? row.key : undefined;
}

function matchesOf(body: unknown): unknown[] | null {
  const matches = body && typeof body === 'object' ? (body as { matches?: unknown }).matches : undefined;
  return Array.isArray(matches) ? matches : null;
}

function keyTaken(key: string): ConflictException {
  return new ConflictException({
    message: `A provider with the key "${key}" is already registered`,
    errorCode: 'METADATA_PROVIDER_KEY_TAKEN',
    errorMeta: { key },
  });
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException({ message: 'Enter the provider address as a full http(s) URL', errorCode: 'METADATA_PROVIDER_INVALID_URL' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException({ message: 'The provider address must use http or https', errorCode: 'METADATA_PROVIDER_INVALID_URL' });
  }
  if (url.username || url.password) {
    throw new BadRequestException({
      message: 'Put credentials in the authorization header, not in the address',
      errorCode: 'METADATA_PROVIDER_INVALID_URL',
    });
  }
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url.toString();
}

function normalizeAuthorization(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function describeError(error: unknown): string {
  if (error instanceof RemoteHostResolutionException) return 'the host name could not be resolved';
  if (error instanceof HttpProviderError) return error.message;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'the provider did not answer in time';
  if (error instanceof Error) return error.message.slice(0, MAX_ERROR_LENGTH);
  return 'unknown error';
}

function errorCodeFor(outcome: { status: MetadataHttpProviderStatus; code?: string }): string {
  if (outcome.code) return outcome.code;
  return outcome.status === 'incompatible' ? 'METADATA_PROVIDER_INVALID_INFO' : 'METADATA_PROVIDER_UNREACHABLE';
}
