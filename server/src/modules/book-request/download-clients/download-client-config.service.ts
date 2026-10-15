import { BadGatewayException, BadRequestException, ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAbsolute as isPosixAbsolute } from 'path/posix';
import type {
  DownloadClientErrorCode,
  DownloadClientItem,
  DownloadClientListResult,
  DownloadClientSummary,
  DownloadClientTestResult,
  DownloadClientType,
  PathMappingHardlinkTestResult,
} from '@bookorbit/types';
import { DOWNLOAD_CLIENT_CREDENTIAL_KIND, DOWNLOAD_CLIENT_DELIVERY } from '@bookorbit/types';

import { isUniqueViolation } from '../../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { PrivateAddressException, ensureSafeUrl } from '../../../common/utils/ssrf.utils';
import type { DownloadClientPathMappingRow, DownloadClientRow } from '../../../db/schema';
import { BookRequestDownloadRepository } from '../fulfillment/book-request-download.repository';
import { RequestCredentialService } from '../request-credential.service';
import type { ResolvedClientConfig } from './download-client-adapter';
import { DownloadClientRegistry } from './download-client-registry';
import { DownloadClientRepository, type DownloadClientWithMappings } from './download-client.repository';
import { ADD_PATH_MAPPING_HINT, PathMappingService } from './path-mapping.service';
import type { CreateDownloadClientDto, UpdateDownloadClientDto, ValidateDownloadClientDto } from './dto/download-client.dto';

/** Editing any of these changes how the adapter reaches the client, so its session must be dropped. */
const CONNECTION_FIELDS = ['baseUrl', 'username', 'password', 'allowPrivateAddress', 'adapterType'] as const satisfies ReadonlyArray<
  keyof UpdateDownloadClientDto
>;

@Injectable()
export class DownloadClientConfigService {
  private readonly logger = new Logger(DownloadClientConfigService.name);
  private readonly bookDockPath: string;
  /** Negative ids handed to session-caching adapters during a transient validation, one per call. */
  private validateSeq = 0;

  constructor(
    private readonly repo: DownloadClientRepository,
    private readonly credentials: RequestCredentialService,
    private readonly registry: DownloadClientRegistry,
    private readonly pathMappings: PathMappingService,
    private readonly downloads: BookRequestDownloadRepository,
    config: ConfigService,
  ) {
    this.bookDockPath = config.getOrThrow<string>('storage.bookDockPath');
  }

  async findAll(): Promise<DownloadClientListResult> {
    const rows = await this.repo.findAll();
    return { clients: rows.map((row) => toItem(row)), encryptionConfigured: this.credentials.isConfigured() };
  }

  /**
   * Names and ids of the clients an approver may pick between. Deliberately not `findAll()`: this
   * one answers to `ManageBookRequests`, and a base URL or a `hasPassword` flag is not something
   * moderating a queue should carry with it.
   */
  async findEnabledSummaries(): Promise<DownloadClientSummary[]> {
    const rows = await this.repo.findAllEnabled();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color ?? null,
      delivery: DOWNLOAD_CLIENT_DELIVERY[row.adapterType as DownloadClientType],
    }));
  }

  async findOne(id: number): Promise<DownloadClientItem> {
    return toItem(await this.requireClient(id));
  }

  async create(dto: CreateDownloadClientDto): Promise<DownloadClientItem> {
    // Everything that can reject the save runs before anything is written. Validating the mappings
    // after the insert would answer "that path is not absolute" while leaving a half-made client
    // behind, which the operator then cannot save over because the name is taken.
    await this.assertReachableUrl(dto.baseUrl, dto.allowPrivateAddress ?? true);
    const pathMappings = this.normalizeRequiredMappings(dto.adapterType, dto.pathMappings);
    this.assertCredentialPresent(dto.adapterType, Boolean(dto.password?.trim()));
    const credentialsEnc = dto.password ? this.credentials.encrypt(dto.password) : null;

    let created: DownloadClientRow;
    try {
      created = await this.repo.createWithPathMappings(
        {
          name: dto.name.trim(),
          color: dto.color ?? null,
          adapterType: dto.adapterType,
          baseUrl: dto.baseUrl.trim(),
          username: dto.username?.trim() || null,
          credentialsEnc,
          enabled: dto.enabled ?? true,
          priority: dto.priority ?? 1,
          category: dto.category?.trim() || 'bookorbit',
          useHardlinks: dto.useHardlinks ?? true,
          allowPrivateAddress: dto.allowPrivateAddress ?? true,
        },
        pathMappings,
      );
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    this.logger.log(`[download_client.create] [end] clientId=${created.id} adapterType=${created.adapterType} - download client created`);
    return toItem(await this.requireClient(created.id));
  }

  async update(id: number, dto: UpdateDownloadClientDto): Promise<DownloadClientItem> {
    const existing = await this.requireClient(id);
    if (dto.adapterType !== undefined && dto.adapterType !== existing.client.adapterType) {
      throw new BadRequestException('A saved download client cannot change type. Create a separate client instead.');
    }
    const hasCredential = dto.password === undefined ? existing.client.credentialsEnc !== null : Boolean(dto.password.trim());
    this.assertCredentialPresent(existing.client.adapterType as DownloadClientType, hasCredential);

    const baseUrl = dto.baseUrl?.trim() ?? existing.client.baseUrl;
    const allowPrivate = dto.allowPrivateAddress ?? existing.client.allowPrivateAddress;
    if (dto.baseUrl !== undefined || dto.allowPrivateAddress !== undefined || dto.adapterType !== undefined) {
      await this.assertReachableUrl(baseUrl, allowPrivate);
    }

    // Only when the edit actually carries mappings. An operator toggling `enabled` on a row that
    // predates this rule must not be refused for a field the form did not send.
    const pathMappings =
      dto.pathMappings !== undefined ? this.normalizeRequiredMappings(existing.client.adapterType as DownloadClientType, dto.pathMappings) : null;

    const patch: Partial<DownloadClientRow> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.adapterType !== undefined) patch.adapterType = dto.adapterType;
    if (dto.baseUrl !== undefined) patch.baseUrl = baseUrl;
    if (dto.username !== undefined) patch.username = dto.username.trim() || null;

    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.category !== undefined) patch.category = dto.category.trim() || 'bookorbit';
    if (dto.useHardlinks !== undefined) patch.useHardlinks = dto.useHardlinks;
    if (dto.allowPrivateAddress !== undefined) patch.allowPrivateAddress = dto.allowPrivateAddress;
    // An omitted password keeps the stored one, so the settings form never has to round-trip it.
    if (dto.password !== undefined) patch.credentialsEnc = dto.password ? this.credentials.encrypt(dto.password) : null;

    try {
      if (Object.keys(patch).length > 0 && !(await this.repo.update(id, patch))) {
        throw new NotFoundException('Download client not found');
      }
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    if (pathMappings !== null) {
      await this.repo.replacePathMappings(id, pathMappings);
    }

    // A cached session outliving the config it was opened with would keep talking to the old host
    // with the old cookie until it happened to be rejected.
    if (CONNECTION_FIELDS.some((field) => dto[field] !== undefined)) {
      this.registry.find(existing.client.adapterType as DownloadClientType)?.forget?.(id);
    }

    return toItem(await this.requireClient(id));
  }

  /**
   * Refused while the client still holds live attempts.
   *
   * The attempt's FK nulls on delete rather than cascading, so the row survives with nothing on it
   * saying where its torrent went: it stops being polled, stops being mappable to a local path and
   * stops being removable, while the client goes on running the transfer. Detaching each one on
   * the operator's behalf would be a guess about work they may want to keep, so they are told the
   * count and left to decide.
   */
  async remove(id: number): Promise<void> {
    const { client } = await this.requireClient(id);

    const live = await this.downloads.countInFlightForClient(id);
    if (live > 0) {
      throw new ConflictException(
        `This client is still working on ${live} ${live === 1 ? 'download' : 'downloads'}. Cancel or remove them first, then delete the client.`,
      );
    }

    this.registry.find(client.adapterType as DownloadClientType)?.forget?.(id);
    await this.repo.delete(id);
    this.logger.log(`[download_client.delete] [end] clientId=${id} - download client removed`);
  }

  /**
   * A test that ran and came back negative answers 502 rather than 200. The stored health stamp
   * is written either way, so the card still shows what happened; what changes is that a script,
   * a curl or a log line can no longer read a refused connection as a pass.
   */
  async test(id: number): Promise<DownloadClientTestResult> {
    const config = await this.resolveConfig(id);
    const adapter = this.registry.require(config.adapterType);
    const result = await adapter.test(config);
    const reason = result.success ? null : (result.error ?? 'Unknown error');
    await this.repo.recordTestResult(id, result.success, reason);

    if (reason !== null) {
      throw new BadGatewayException({ message: reason, errorCode: 'DOWNLOAD_CLIENT_TEST_FAILED', statusCode: HttpStatus.BAD_GATEWAY });
    }
    return result;
  }

  /**
   * A credential check for a client that may not have been saved yet: the form can tell an
   * operator their key is wrong while they are still typing it. The config is built from what
   * the form sent, handed to the adapter and discarded, so nothing is stored or returned.
   */
  async validate(dto: ValidateDownloadClientDto): Promise<DownloadClientTestResult> {
    const adapter = this.registry.require(dto.adapterType);
    // A session-caching adapter keys its cookie by config id, so a shared id would let one
    // validation's session authenticate the next, and would send the earlier host's cookie to a
    // URL the operator has since changed. A negative id cannot collide with a saved client's
    // serial, and one per call keeps concurrent validations from sharing a slot.
    const ephemeralId = --this.validateSeq;
    try {
      return await adapter.test({
        id: ephemeralId,
        name: adapter.label,
        adapterType: dto.adapterType,
        baseUrl: dto.baseUrl.trim(),
        username: dto.username?.trim() || null,
        password: dto.password ?? null,
        category: 'bookorbit',
        allowPrivateAddress: false,
        settings: null,
      });
    } finally {
      // Disposed either way, so no session outlives the validation that opened it.
      adapter.forget?.(ephemeralId);
    }
  }

  /**
   * The directory comes from the named mapping, never from the request body: the probe writes and
   * unlinks where it is pointed, so a caller-supplied path would make this an arbitrary-directory
   * write and existence oracle over the whole host, which is exactly what every other filesystem
   * path in BookOrbit is rooted to stop.
   */
  async testHardlink(id: number, mappingId: number): Promise<PathMappingHardlinkTestResult> {
    const { pathMappings } = await this.requireClient(id);
    const mapping = pathMappings.find((row) => row.id === mappingId);
    if (!mapping) throw new NotFoundException('Path mapping not found');
    return this.pathMappings.testHardlink(mapping.localPath, this.bookDockPath);
  }

  /**
   * The only place credentials are decrypted. Callers get a value object, never the row, so a
   * `credentialsEnc` blob cannot reach a response body or a log line by accident.
   */
  async resolveConfig(id: number): Promise<ResolvedClientConfig> {
    const { client } = await this.requireClient(id);
    return {
      id: client.id,
      name: client.name,
      adapterType: client.adapterType as DownloadClientType,
      baseUrl: client.baseUrl,
      username: client.username,
      password: client.credentialsEnc ? this.credentials.decrypt(client.credentialsEnc) : null,
      category: client.category,
      allowPrivateAddress: client.allowPrivateAddress,
      settings: client.settings ?? null,
    };
  }

  /** Whether the configured client keeps its files remotely and BookOrbit stages them itself. */
  async stagesLocally(id: number): Promise<boolean> {
    const { client } = await this.requireClient(id);
    return this.adapterStagesLocally(client.adapterType as DownloadClientType);
  }

  async findPreferredEnabled(adapterTypes: readonly DownloadClientType[]): Promise<DownloadClientRow | undefined> {
    return this.repo.findPreferredEnabled(adapterTypes);
  }

  async useHardlinks(id: number): Promise<boolean> {
    const { client } = await this.requireClient(id);
    return client.useHardlinks;
  }

  private normalizeRequiredMappings(
    adapterType: DownloadClientType,
    mappings: Array<{ remotePath: string; localPath: string }> | undefined,
  ): Array<{ remotePath: string; localPath: string }> {
    const normalized = normalizeMappings(mappings);
    // A client that stages its own files lands them under a root BookOrbit owns, so a mapping
    // declaring which directory may be imported from has nothing to declare.
    if (normalized.length > 0 || this.adapterStagesLocally(adapterType)) return normalized;
    throw downloadClientError(
      'DOWNLOAD_CLIENT_MAPPING_REQUIRED',
      `A download client needs at least one path mapping, so BookOrbit knows which directory it may import from. ${ADD_PATH_MAPPING_HINT}`,
    );
  }

  private adapterStagesLocally(adapterType: DownloadClientType): boolean {
    return typeof this.registry.find(adapterType)?.stage === 'function';
  }

  private async requireClient(id: number): Promise<DownloadClientWithMappings> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Download client not found');
    return row;
  }

  /**
   * Clients usually live on the LAN, so `allowPrivate` is a per-row opt-in with the implication
   * stated in the UI rather than a blanket relaxation.
   */
  private async assertReachableUrl(baseUrl: string, allowPrivate: boolean): Promise<void> {
    try {
      await ensureSafeUrl(baseUrl, { allowPrivate });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[download_client.url_check] [fail] error="${sanitizeLogValue(message)}" - rejected download client base URL`);
      const isPrivateAddress = error instanceof PrivateAddressException;
      throw downloadClientError(
        isPrivateAddress ? 'DOWNLOAD_CLIENT_URL_PRIVATE' : 'DOWNLOAD_CLIENT_URL_UNSAFE',
        isPrivateAddress && !allowPrivate ? `${message}. Enable "Allow private addresses" if this client is on your local network.` : message,
      );
    }
  }

  private translateUniqueViolation(error: unknown): unknown {
    if (isUniqueViolation(error)) {
      return new ConflictException({ message: 'A download client with this name already exists', errorCode: 'DOWNLOAD_CLIENT_NAME_TAKEN' });
    }
    return error;
  }

  private assertCredentialPresent(adapterType: DownloadClientType, hasCredential: boolean): void {
    if (DOWNLOAD_CLIENT_CREDENTIAL_KIND[adapterType] === 'apiKey' && !hasCredential) {
      const label = this.registry.find(adapterType)?.label ?? adapterType;
      throw downloadClientError('DOWNLOAD_CLIENT_CREDENTIAL_REQUIRED', `${label} needs an API key`);
    }
  }
}

/** Carries a stable code alongside the English text, so the settings form can translate it. */
function downloadClientError(errorCode: DownloadClientErrorCode, message: string): BadRequestException {
  return new BadRequestException({ message, errorCode, statusCode: HttpStatus.BAD_REQUEST });
}

/** A Windows client reports `D:\downloads`; the local side is always POSIX. Both must be rooted. */
function isAbsoluteRemotePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return isPosixAbsolute(normalized) || /^[a-z]:\//i.test(normalized);
}

function normalizeMappings(mappings: Array<{ remotePath: string; localPath: string }> | undefined): Array<{ remotePath: string; localPath: string }> {
  if (!mappings?.length) return [];

  const seen = new Set<string>();
  const normalized: Array<{ remotePath: string; localPath: string }> = [];
  for (const mapping of mappings) {
    const remotePath = mapping.remotePath.trim();
    const localPath = mapping.localPath.trim();
    if (!remotePath || !localPath) continue;
    // A relative path would resolve against the server process's working directory at import
    // time, which is neither what the operator typed nor anywhere predictable.
    if (!isAbsoluteRemotePath(remotePath) || !isPosixAbsolute(localPath)) {
      throw downloadClientError('DOWNLOAD_CLIENT_PATH_NOT_ABSOLUTE', `Path mappings must use absolute paths: "${remotePath}" -> "${localPath}"`);
    }
    // The unique index would reject a duplicate remote prefix mid-transaction; drop it here so
    // the operator gets an edit that saves rather than a 409 from a row they cannot see.
    if (seen.has(remotePath)) continue;
    seen.add(remotePath);
    normalized.push({ remotePath, localPath });
  }
  return normalized;
}

function toItem({ client, pathMappings }: DownloadClientWithMappings): DownloadClientItem {
  return {
    id: client.id,
    name: client.name,
    color: client.color ?? null,
    adapterType: client.adapterType as DownloadClientType,
    enabled: client.enabled,
    priority: client.priority,
    baseUrl: client.baseUrl,
    username: client.username,
    hasPassword: client.credentialsEnc !== null,
    category: client.category,
    useHardlinks: client.useHardlinks,
    allowPrivateAddress: client.allowPrivateAddress,
    lastTestedAt: client.lastTestedAt?.toISOString() ?? null,
    lastTestOk: client.lastTestOk,
    lastErrorMessage: client.lastErrorMessage,
    pathMappings: pathMappings.map(toMappingItem),
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

function toMappingItem(row: DownloadClientPathMappingRow) {
  return { id: row.id, remotePath: row.remotePath, localPath: row.localPath };
}
