import { BadGatewayException, BadRequestException, ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BOOK_REQUEST_MEDIA_KINDS, INDEXER_ADAPTER_TYPES, pickUnusedIndexerColor } from '@bookorbit/types';
import type {
  BookRequestMediaKind,
  BookRequestSourceStatus,
  IndexerAdapterType,
  IndexerCategoryMap,
  IndexerErrorCode,
  IndexerItem,
  IndexerListResult,
  IndexerSettings,
  IndexerSettingsField,
  IndexerTestResult,
} from '@bookorbit/types';

import { isUniqueViolation } from '../../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { PrivateAddressException, ensureSafeUrl } from '../../../common/utils/ssrf.utils';
import type { RequestIndexerRow } from '../../../db/schema';
import { RequestCredentialService } from '../request-credential.service';
import type { ResolvedIndexerConfig } from './indexer-adapter';
import { IndexerRegistry } from './indexer-registry';
import { IndexerRepository } from './indexer.repository';
import type { CreateIndexerDto, UpdateIndexerDto } from './dto/indexer.dto';

const MAX_INDEXER_SETTING_STRING_LENGTH = 2_048;

/** Editing any of these changes how the adapter reaches the tracker, so its session must be dropped. */
const CONNECTION_FIELDS = ['baseUrl', 'credential', 'allowPrivateAddress', 'adapterType'] as const satisfies ReadonlyArray<keyof UpdateIndexerDto>;

@Injectable()
export class IndexerConfigService {
  private readonly logger = new Logger(IndexerConfigService.name);

  constructor(
    private readonly repo: IndexerRepository,
    private readonly credentials: RequestCredentialService,
    private readonly registry: IndexerRegistry,
  ) {}

  async findAll(): Promise<IndexerListResult> {
    const rows = await this.repo.findAll();
    return { indexers: rows.map((row) => this.toItem(row)), encryptionConfigured: this.credentials.isConfigured() };
  }

  async findOne(id: number): Promise<IndexerItem> {
    return this.toItem(await this.requireIndexer(id));
  }

  /**
   * The categories a row actually searches: what the operator chose, or what the adapter declares
   * for the ones they left alone. Read through the registry, so a plugin's own defaults are used
   * rather than the compile-time map, which only knows the built-ins.
   */
  private resolveCategories(row: RequestIndexerRow): IndexerCategoryMap {
    return mergeCategories(this.registry.defaultCategories(row.adapterType), row.categories ?? undefined);
  }

  private toItem(row: RequestIndexerRow): IndexerItem {
    return toItem(row, this.resolveCategories(row));
  }

  async create(dto: CreateIndexerDto): Promise<IndexerItem> {
    // Everything that can reject the save runs before anything is written, so a rejected URL does
    // not leave a half-made indexer behind whose name the operator then cannot save over.
    await this.assertReachableUrl(dto.baseUrl, dto.allowPrivateAddress ?? false);
    this.assertCredentialPresent(dto.adapterType, Boolean(dto.credential?.trim()));
    const credentialsEnc = dto.credential ? this.credentials.encrypt(dto.credential) : null;
    const color = dto.color === undefined ? pickUnusedIndexerColor(await this.repo.findAssignedColors()) : dto.color;

    try {
      const created = await this.repo.create({
        name: dto.name.trim(),
        color,
        adapterType: dto.adapterType,
        baseUrl: dto.baseUrl.trim(),
        credentialsEnc,
        enabled: dto.enabled ?? true,
        allowPrivateAddress: dto.allowPrivateAddress ?? false,
        categories: mergeCategories(this.registry.defaultCategories(dto.adapterType), dto.categories),
        disabledMediaKinds: normalizeDisabledMediaKinds(dto.disabledMediaKinds),
        isbnSearchDisabled: dto.isbnSearchDisabled ?? false,
        settings: this.cleanSettings(dto.adapterType, dto.settings),
        networkProfile: dto.networkProfile ?? null,
      });
      this.logger.log(`[request_indexer.create] [end] indexerId=${created.id} adapterType=${created.adapterType} - indexer created`);
      return this.toItem(created);
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  async update(id: number, dto: UpdateIndexerDto): Promise<IndexerItem> {
    const existing = await this.requireIndexer(id);

    const baseUrl = dto.baseUrl?.trim() ?? existing.baseUrl;
    const allowPrivate = dto.allowPrivateAddress ?? existing.allowPrivateAddress;
    if (dto.baseUrl !== undefined || dto.allowPrivateAddress !== undefined) {
      await this.assertReachableUrl(baseUrl, allowPrivate);
    }

    const adapterType = (dto.adapterType ?? existing.adapterType) as IndexerAdapterType;
    // A credential and a settings blob belong to the adapter they were entered for. Carrying them
    // across a type change leaves the row holding a key of the wrong kind and settings the new
    // adapter never declared, which then reach it as a rejected search rather than as a refusal
    // the operator can act on while the form is still open.
    const changesAdapter = adapterType !== existing.adapterType;
    const keepsCredential = dto.credential === undefined ? !changesAdapter && existing.credentialsEnc !== null : Boolean(dto.credential.trim());
    this.assertCredentialPresent(adapterType, keepsCredential);

    const patch: Partial<RequestIndexerRow> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.adapterType !== undefined) patch.adapterType = dto.adapterType;
    if (dto.baseUrl !== undefined) patch.baseUrl = baseUrl;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.allowPrivateAddress !== undefined) patch.allowPrivateAddress = dto.allowPrivateAddress;
    if (dto.categories !== undefined) patch.categories = mergeCategories(this.registry.defaultCategories(adapterType), dto.categories);
    if (dto.disabledMediaKinds !== undefined) patch.disabledMediaKinds = normalizeDisabledMediaKinds(dto.disabledMediaKinds);
    if (dto.isbnSearchDisabled !== undefined) patch.isbnSearchDisabled = dto.isbnSearchDisabled;
    if (dto.settings !== undefined) patch.settings = this.cleanSettings(adapterType, dto.settings);
    else if (changesAdapter) patch.settings = null;
    if (dto.networkProfile !== undefined) patch.networkProfile = dto.networkProfile;
    // An omitted credential keeps the stored one, so the settings form never round-trips a secret.
    if (dto.credential !== undefined) patch.credentialsEnc = dto.credential ? this.credentials.encrypt(dto.credential) : null;
    else if (changesAdapter) patch.credentialsEnc = null;

    try {
      if (Object.keys(patch).length > 0 && !(await this.repo.update(id, patch))) {
        throw new NotFoundException('Indexer not found');
      }
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    // A cached session outliving the config it was opened with would keep talking to the old host
    // with the old credential until it happened to be rejected.
    if (CONNECTION_FIELDS.some((field) => dto[field] !== undefined)) {
      this.registry.find(existing.adapterType as IndexerAdapterType)?.forget?.(id);
    }

    return this.toItem(await this.requireIndexer(id));
  }

  async remove(id: number): Promise<void> {
    const existing = await this.requireIndexer(id);
    if (!(INDEXER_ADAPTER_TYPES as readonly string[]).includes(existing.adapterType)) {
      throw new BadRequestException('A plugin-backed source must be deleted with its plugin');
    }
    this.registry.find(existing.adapterType as IndexerAdapterType)?.forget?.(id);
    await this.repo.delete(id);
    this.logger.log(`[request_indexer.delete] [end] indexerId=${id} - indexer removed`);
  }

  /**
   * A test that ran and came back negative answers 502 rather than 200. The stored health stamp
   * is written either way, so the card still shows what happened; what changes is that a script,
   * a curl or a log line can no longer read a refused connection as a pass.
   */
  async test(id: number): Promise<IndexerTestResult> {
    const config = await this.resolveConfig(id);
    const adapter = this.registry.require(config.adapterType);
    const result = await adapter.test(config);
    const reason = result.success ? null : (result.error ?? 'Unknown error');
    await this.repo.recordTestResult(id, result.success, reason);

    if (reason !== null) {
      throw new BadGatewayException({ message: reason, errorCode: 'INDEXER_TEST_FAILED', statusCode: HttpStatus.BAD_GATEWAY });
    }
    return result;
  }

  /**
   * How many sources exist and how many are on. The only fact about the indexer list a requester
   * is allowed, and what lets an empty release list say why it is empty.
   */
  countSources(): Promise<BookRequestSourceStatus> {
    return this.repo.countSources();
  }

  /**
   * How the last real search went, per source. Written by the search rather than read by it: the
   * settings list is where this is shown, and a picker's live failure list stops existing the
   * moment the drawer closes.
   */
  recordSearchOutcomes(outcomes: ReadonlyArray<{ indexerId: number; ok: boolean; error: string | null }>): Promise<void> {
    return this.repo.recordSearchOutcomes(outcomes);
  }

  /**
   * Every enabled indexer, resolved for search. One decrypt pass, not one per release.
   *
   * Decrypted per row rather than in one throwing pass. A rotated or unset
   * `BOOK_REQUEST_ENCRYPTION_KEY` leaves stored credentials unreadable, and one such row used to
   * abort the whole fan-out: every other source, including the ones holding no credential at all,
   * went unsearched and the picker showed an error with nothing in it. The row travels with its
   * own refusal instead, so the search reports it as that source's failure.
   */
  async resolveEnabledConfigs(): Promise<ResolvedIndexerConfig[]> {
    const rows = await this.repo.findAllEnabled();
    return rows.map((row) => {
      try {
        return this.toConfig(row);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[request_indexer.resolve] [fail] indexerId=${row.id} error="${sanitizeLogValue(message)}" - the stored credential could not be read, so this source is reported as unauthorized`,
        );
        return { ...this.toConfig({ ...row, credentialsEnc: null }), credentialError: message };
      }
    });
  }

  /**
   * The only place a credential is decrypted. Callers get a value object, never the row, so a
   * `credentialsEnc` blob cannot reach a response body or a log line by accident.
   */
  async resolveConfig(id: number): Promise<ResolvedIndexerConfig> {
    return this.toConfig(await this.requireIndexer(id));
  }

  private toConfig(row: RequestIndexerRow): ResolvedIndexerConfig {
    return {
      id: row.id,
      name: row.name,
      color: row.color ?? null,
      adapterType: row.adapterType as IndexerAdapterType,
      baseUrl: row.baseUrl,
      credential: row.credentialsEnc ? this.credentials.decrypt(row.credentialsEnc) : null,
      credentialError: null,
      allowPrivateAddress: row.allowPrivateAddress,
      categories: this.resolveCategories(row),
      disabledMediaKinds: normalizeDisabledMediaKinds(row.disabledMediaKinds),
      isbnSearchDisabled: row.isbnSearchDisabled,
      settings: row.settings ?? null,
      networkProfile: row.networkProfile ?? null,
    };
  }

  private async requireIndexer(id: number): Promise<RequestIndexerRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Indexer not found');
    return row;
  }

  /**
   * Whitelisting by the adapter's own declaration, since the pipe cannot: `settings` is opaque at
   * the DTO because an adapter loaded at runtime names its own fields. Anything undeclared is
   * dropped rather than stored, so a jsonb column never takes a blob nobody asked for.
   */
  private cleanSettings(adapterType: string, settings: Record<string, unknown> | undefined): IndexerSettings | null {
    if (!settings) return null;
    const declared = this.registry.require(adapterType).settingsFields ?? [];
    const kept: Record<string, unknown> = {};

    for (const field of declared) {
      const value = settings[field.key];
      if (value === undefined || value === null) continue;
      if (field.type === 'boolean' && typeof value !== 'boolean') continue;
      if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) continue;
      if (field.type === 'string' && (typeof value !== 'string' || value.length > MAX_INDEXER_SETTING_STRING_LENGTH)) continue;
      kept[field.key] = field.type === 'string' && field.format === 'list' ? this.cleanListSetting(field, value as string) : value;
    }

    const dropped = Object.keys(settings).filter((key) => !(key in kept));
    if (dropped.length > 0) {
      this.logger.warn(
        `[request_indexer.settings] [fail] adapterType=${adapterType} dropped="${sanitizeLogValue(dropped.join(','))}" - settings the adapter does not declare`,
      );
    }
    return Object.keys(kept).length > 0 ? kept : null;
  }

  private cleanListSetting(field: IndexerSettingsField, value: string): string {
    const canonicalByValue = field.options ? new Map(field.options.map((option) => [option.toLowerCase(), option])) : null;
    const entries = canonicalByValue
      ? [
          ...new Map(
            value
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
              .map((entry) => [entry.toLowerCase(), entry]),
          ).values(),
        ]
      : [
          ...new Set(
            value
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean),
          ),
        ];
    const canonical = canonicalByValue
      ? entries.map((entry) => canonicalByValue.get(entry.toLowerCase())).filter((entry): entry is string => entry !== undefined)
      : entries;

    if (canonicalByValue && canonical.length !== entries.length) {
      throw indexerError('INDEXER_SETTINGS_INVALID', `${field.label} contains a value the plugin does not support`);
    }
    if (canonical.length < (field.minItems ?? 0)) {
      throw indexerError('INDEXER_SETTINGS_INVALID', `${field.label} requires at least ${field.minItems} selection`);
    }
    return canonical.join(',');
  }

  /**
   * A private tracker rejects every search without one, and it would do so as a per-indexer
   * failure in the picker rather than as a save error the operator can act on.
   */
  private assertCredentialPresent(adapterType: string, hasCredential: boolean): void {
    const adapter = this.registry.require(adapterType);
    if (adapter.requiresCredential && !hasCredential) {
      throw indexerError('INDEXER_CREDENTIAL_REQUIRED', `${adapter.label} cannot be used without a credential`);
    }
  }

  /**
   * Unlike a download client this defaults to off: a public tracker has no business resolving to
   * a private address, and a self-hosted torznab proxy is the one case worth opting into.
   */
  private async assertReachableUrl(baseUrl: string, allowPrivate: boolean): Promise<void> {
    try {
      await ensureSafeUrl(baseUrl, { allowPrivate });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[request_indexer.url_check] [fail] error="${sanitizeLogValue(message)}" - rejected indexer base URL`);
      const isPrivateAddress = error instanceof PrivateAddressException;
      throw indexerError(
        isPrivateAddress ? 'INDEXER_URL_PRIVATE' : 'INDEXER_URL_UNSAFE',
        isPrivateAddress && !allowPrivate ? `${message}. Enable "Allow private addresses" if this is a torznab proxy on your own network.` : message,
      );
    }
  }

  private translateUniqueViolation(error: unknown): unknown {
    if (isUniqueViolation(error)) {
      return new ConflictException({ message: 'An indexer with this name already exists', errorCode: 'INDEXER_NAME_TAKEN' });
    }
    return error;
  }
}

/** Carries a stable code alongside the English text, so the settings form can translate it. */
function indexerError(errorCode: IndexerErrorCode, message: string): BadRequestException {
  return new BadRequestException({ message, errorCode, statusCode: HttpStatus.BAD_REQUEST });
}

/**
 * A medium the operator left blank falls back to the adapter's default rather than searching no
 * categories at all, which most trackers answer with everything they have.
 */
function mergeCategories(defaults: IndexerCategoryMap, categories: Partial<IndexerCategoryMap> | undefined): IndexerCategoryMap {
  return {
    ebook: categories?.ebook ?? defaults.ebook,
    audiobook: categories?.audiobook ?? defaults.audiobook,
    comic: categories?.comic ?? defaults.comic,
  };
}

/**
 * A jsonb column can hold whatever a hand-edited row put there, and this list decides which
 * searches a source is left out of. Anything that is not a medium is dropped rather than kept,
 * so a typo cannot silently take a tracker out of every search.
 */
function normalizeDisabledMediaKinds(value: unknown): BookRequestMediaKind[] {
  if (!Array.isArray(value)) return [];
  return BOOK_REQUEST_MEDIA_KINDS.filter((kind) => value.includes(kind));
}

function toItem(row: RequestIndexerRow, categories: IndexerCategoryMap): IndexerItem {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    adapterType: row.adapterType as IndexerAdapterType,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    hasCredential: row.credentialsEnc !== null,
    allowPrivateAddress: row.allowPrivateAddress,
    categories,
    disabledMediaKinds: normalizeDisabledMediaKinds(row.disabledMediaKinds),
    isbnSearchDisabled: row.isbnSearchDisabled,
    settings: row.settings ?? {},
    networkProfile: row.networkProfile ?? null,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastErrorMessage: row.lastErrorMessage,
    lastSearchAt: row.lastSearchAt?.toISOString() ?? null,
    lastSearchOk: row.lastSearchOk,
    lastSearchError: row.lastSearchError,
    searchFailureStreak: row.searchFailureStreak,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
