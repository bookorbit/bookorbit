import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { IndexerPlugin, PluginUpdateManifest } from '@bookorbit/plugin-api';
import type { PluginInstallResult, PluginUpdateReview, PluginUpdateStatus } from '@bookorbit/types';

import { safeFetch } from '../../../../common/utils/safe-fetch';
import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { IndexerRegistry } from '../indexer-registry';
import { PluginIndexerAdapter } from './plugin-host';
import { MAX_PLUGIN_BYTES, PluginInstallService } from './plugin-install.service';
import { PluginLoaderService } from './plugin-loader.service';

const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;
const STATE_FILE = '.update-state.json';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface StoredUpdateState {
  autoUpdate: boolean;
  manifestUrl?: string;
  etag?: string;
  checkedAt?: string;
  manifest?: PluginUpdateManifest;
}

interface Candidate {
  manifest: PluginUpdateManifest;
  source: string;
}

@Injectable()
export class PluginUpdateService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PluginUpdateService.name);
  private readonly statuses = new Map<string, PluginUpdateStatus>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly registry: IndexerRegistry,
    private readonly loader: PluginLoaderService,
    private readonly installer: PluginInstallService,
  ) {}

  onApplicationBootstrap(): void {
    const initial = setTimeout(() => void this.refreshAll(false, true), 0);
    initial.unref();
    this.timer = setInterval(() => void this.refreshAll(true, true), UPDATE_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(): Promise<PluginUpdateStatus[]> {
    const plugins = this.plugins();
    return Promise.all(plugins.map(async (plugin) => this.statuses.get(plugin.type) ?? this.initialStatus(plugin)));
  }

  async refreshAll(force = true, installAutomatic = false): Promise<PluginUpdateStatus[]> {
    const results: PluginUpdateStatus[] = [];
    for (const plugin of this.plugins()) {
      const status = await this.checkOne(plugin.type, force);
      if (installAutomatic && status.autoUpdate && status.state === 'available') {
        try {
          results.push(await this.apply(plugin.type, undefined, 'system:auto-update'));
        } catch (error) {
          results.push(await this.failedStatus(plugin, error));
        }
      } else {
        results.push(status);
      }
    }
    return results;
  }

  async checkOne(type: string, force = true): Promise<PluginUpdateStatus> {
    const plugin = this.requirePlugin(type);
    if (!plugin.update) return this.remember({ type, currentVersion: plugin.version, state: 'unsupported', autoUpdate: false });

    const stored = await this.readState(type);
    const checkedAt = stored.checkedAt ? Date.parse(stored.checkedAt) : 0;
    const cacheIsFresh = stored.manifestUrl === plugin.update.manifestUrl && Date.now() - checkedAt < UPDATE_CHECK_INTERVAL_MS;
    if (!force && cacheIsFresh && stored.manifest) return this.evaluate(plugin, stored.manifest, stored);

    const started = Date.now();
    this.logger.log(`[request_indexer.plugin_update_check] [start] type=${type} - checking signed update manifest`);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (stored.manifestUrl === plugin.update.manifestUrl && stored.etag) headers['If-None-Match'] = stored.etag;
      const response = await requestBounded(plugin.update.manifestUrl, headers, MAX_MANIFEST_BYTES, true);
      const manifest = response.status === 304 ? stored.manifest : parseManifest(response.body, type);
      if (!manifest) throw new Error('the server returned 304 without a cached manifest');

      const next: StoredUpdateState = {
        autoUpdate: stored.autoUpdate,
        manifestUrl: plugin.update.manifestUrl,
        ...((response.etag ?? stored.etag) ? { etag: response.etag ?? stored.etag } : {}),
        checkedAt: new Date().toISOString(),
        manifest,
      };
      await this.writeState(type, next);
      const status = await this.evaluate(plugin, manifest, next);
      this.logger.log(
        `[request_indexer.plugin_update_check] [end] type=${type} state=${status.state} durationMs=${Date.now() - started} - update check completed`,
      );
      return status;
    } catch (error) {
      const status = await this.failedStatus(plugin, error, stored.autoUpdate);
      this.logger.warn(
        `[request_indexer.plugin_update_check] [fail] type=${type} durationMs=${Date.now() - started} errorClass=${errorClass(error)} ` +
          `error="${sanitizeLogValue(messageOf(error))}" - update check failed`,
      );
      return status;
    }
  }

  async inspect(type: string): Promise<PluginUpdateReview> {
    const plugin = this.requirePlugin(type);
    const candidate = await this.candidateFor(plugin);
    const inspection = await this.installer.inspect(candidate.source);
    assertCandidateMatches(plugin, candidate.manifest, inspection.type, inspection.version);
    return {
      ...inspection,
      ...(plugin.version ? { currentVersion: plugin.version } : {}),
      sha256: candidate.manifest.sha256,
      verified: true,
    };
  }

  async apply(type: string, expectedSha256: string | undefined, installedBy: string): Promise<PluginUpdateStatus> {
    const plugin = this.requirePlugin(type);
    const candidate = await this.candidateFor(plugin);
    if (expectedSha256 && candidate.manifest.sha256 !== expectedSha256) {
      throw new BadRequestException('The published update changed after it was reviewed. Review the new version before installing it.');
    }
    if (compareVersions(candidate.manifest.version, plugin.version ?? '0.0.0') <= 0) {
      throw new BadRequestException('That plugin version is not newer than the installed version');
    }

    const result = await this.installer.installVerifiedUpdate(candidate.source, type, installedBy);
    const stored = await this.readState(type);
    const next: StoredUpdateState = {
      ...stored,
      manifestUrl: plugin.update!.manifestUrl,
      checkedAt: new Date().toISOString(),
      manifest: candidate.manifest,
    };
    await this.writeState(type, next);
    return this.remember(statusFromInstall(result, next));
  }

  async setAutomatic(type: string, enabled: boolean): Promise<PluginUpdateStatus> {
    const plugin = this.requirePlugin(type);
    if (!plugin.update) throw new BadRequestException('That plugin does not publish signed updates');
    const stored = await this.readState(type);
    await this.writeState(type, { ...stored, autoUpdate: enabled });
    const status = await this.checkOne(type, true);
    if (enabled && status.state === 'available') return this.apply(type, undefined, 'system:auto-update');
    return status;
  }

  private async candidateFor(plugin: IndexerPlugin): Promise<Candidate> {
    if (!plugin.update) throw new BadRequestException('That plugin does not publish signed updates');
    const status = await this.checkOne(plugin.type, false);
    if (status.state === 'failed') throw new BadRequestException(status.error ?? 'The update check failed');
    const stored = await this.readState(plugin.type);
    const manifest = stored.manifest;
    if (!manifest) throw new BadRequestException('No plugin update manifest is available');

    const response = await requestBounded(manifest.sourceUrl, { Accept: 'text/javascript, text/plain' }, MAX_PLUGIN_BYTES, false);
    const source = response.body;
    const digest = sha256(source);
    if (digest !== manifest.sha256) throw new BadRequestException('The downloaded plugin does not match the digest in its update manifest');
    if (!verifySignature(source, manifest.signature, plugin.update.ed25519PublicKey)) {
      throw new BadRequestException('The downloaded plugin does not have a valid publisher signature');
    }
    return { manifest, source };
  }

  private async evaluate(plugin: IndexerPlugin, manifest: PluginUpdateManifest, stored: StoredUpdateState): Promise<PluginUpdateStatus> {
    const installedVersion = plugin.version;
    let state: PluginUpdateStatus['state'] = 'custom';
    if (installedVersion) {
      const comparison = compareVersions(manifest.version, installedVersion);
      if (comparison > 0) state = 'available';
      else if (comparison === 0) state = (await this.installedDigest(plugin.type)) === manifest.sha256 ? 'current' : 'custom';
    }
    return this.remember({
      type: plugin.type,
      ...(installedVersion ? { currentVersion: installedVersion } : {}),
      latestVersion: manifest.version,
      state,
      autoUpdate: stored.autoUpdate,
      ...(stored.checkedAt ? { checkedAt: stored.checkedAt } : {}),
    });
  }

  private async initialStatus(plugin: IndexerPlugin): Promise<PluginUpdateStatus> {
    if (!plugin.update) return { type: plugin.type, currentVersion: plugin.version, state: 'unsupported', autoUpdate: false };
    const stored = await this.readState(plugin.type);
    if (stored.manifest) return this.evaluate(plugin, stored.manifest, stored);
    return {
      type: plugin.type,
      ...(plugin.version ? { currentVersion: plugin.version } : {}),
      state: 'unchecked',
      autoUpdate: stored.autoUpdate,
    };
  }

  private async failedStatus(plugin: IndexerPlugin, error: unknown, autoUpdate?: boolean): Promise<PluginUpdateStatus> {
    const stored = autoUpdate === undefined ? await this.readState(plugin.type) : null;
    return this.remember({
      type: plugin.type,
      ...(plugin.version ? { currentVersion: plugin.version } : {}),
      state: 'failed',
      autoUpdate: autoUpdate ?? stored?.autoUpdate ?? false,
      error: messageOf(error),
    });
  }

  private plugins(): IndexerPlugin[] {
    return this.registry
      .all()
      .filter((adapter): adapter is PluginIndexerAdapter => adapter instanceof PluginIndexerAdapter)
      .map((adapter) => adapter.plugin);
  }

  private requirePlugin(type: string): IndexerPlugin {
    const adapter = this.registry.find(type);
    if (!(adapter instanceof PluginIndexerAdapter)) throw new BadRequestException(`No installed plugin called "${type}" exists`);
    return adapter.plugin;
  }

  private remember(status: PluginUpdateStatus): PluginUpdateStatus {
    this.statuses.set(status.type, status);
    return status;
  }

  private statePath(type: string): string {
    const directory = this.loader.directoryForType(type);
    if (!directory || directory.includes('/') || directory.includes('\\'))
      throw new BadRequestException(`No installed plugin called "${type}" exists`);
    const root = resolve(this.loader.root);
    const pluginRoot = resolve(root, directory);
    const pathFromRoot = relative(root, pluginRoot);
    if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new BadRequestException('The plugin directory is unsafe');
    }
    return join(pluginRoot, STATE_FILE);
  }

  private async readState(type: string): Promise<StoredUpdateState> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath(type), 'utf8')) as Partial<StoredUpdateState>;
      return {
        autoUpdate: parsed.autoUpdate === true,
        ...(typeof parsed.manifestUrl === 'string' ? { manifestUrl: parsed.manifestUrl } : {}),
        ...(typeof parsed.etag === 'string' ? { etag: parsed.etag } : {}),
        ...(typeof parsed.checkedAt === 'string' ? { checkedAt: parsed.checkedAt } : {}),
        ...(isManifest(parsed.manifest, type) ? { manifest: parsed.manifest } : {}),
      };
    } catch {
      return { autoUpdate: false };
    }
  }

  private async writeState(type: string, state: StoredUpdateState): Promise<void> {
    const path = this.statePath(type);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async installedDigest(type: string): Promise<string | null> {
    const directory = this.loader.directoryForType(type);
    if (!directory) return null;
    const base = resolve(this.loader.root, directory);
    for (const entrypoint of ['index.mjs', 'index.js']) {
      try {
        return sha256(await readFile(join(base, entrypoint), 'utf8'));
      } catch {
        continue;
      }
    }
    return null;
  }
}

function parseManifest(body: string, expectedType: string): PluginUpdateManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('the update manifest is not valid JSON');
  }
  if (!isManifest(parsed, expectedType)) throw new Error('the update manifest has an invalid shape');
  return parsed;
}

function isManifest(value: unknown, expectedType: string): value is PluginUpdateManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<PluginUpdateManifest>;
  if (manifest.schemaVersion !== 1 || manifest.type !== expectedType || typeof manifest.version !== 'string' || !parseVersion(manifest.version))
    return false;
  if (typeof manifest.sourceUrl !== 'string' || !isHttpsUrl(manifest.sourceUrl)) return false;
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return false;
  return typeof manifest.signature === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature);
}

function assertCandidateMatches(plugin: IndexerPlugin, manifest: PluginUpdateManifest, type: string, version?: string): void {
  if (type !== plugin.type) throw new BadRequestException(`The update declares "${type}" instead of "${plugin.type}"`);
  if (version !== manifest.version) throw new BadRequestException('The update source version does not match its manifest');
}

function verifySignature(source: string, signature: string, publicKey: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
    return verify(null, Buffer.from(source), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function statusFromInstall(result: PluginInstallResult, stored: StoredUpdateState): PluginUpdateStatus {
  return {
    type: result.type,
    ...(result.version ? { currentVersion: result.version, latestVersion: result.version } : {}),
    state: 'current',
    autoUpdate: stored.autoUpdate,
    ...(stored.checkedAt ? { checkedAt: stored.checkedAt } : {}),
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  if (!a[4] && b[4]) return 1;
  if (a[4] && !b[4]) return -1;
  const aPrerelease = String(a[4] ?? '').split('.');
  const bPrerelease = String(b[4] ?? '').split('.');
  for (let index = 0; index < Math.max(aPrerelease.length, bPrerelease.length); index += 1) {
    const aIdentifier = aPrerelease[index];
    const bIdentifier = bPrerelease[index];
    if (aIdentifier === undefined) return -1;
    if (bIdentifier === undefined) return 1;
    if (aIdentifier === bIdentifier) continue;

    const aNumeric = /^\d+$/.test(aIdentifier);
    const bNumeric = /^\d+$/.test(bIdentifier);
    if (aNumeric && !bNumeric) return -1;
    if (!aNumeric && bNumeric) return 1;
    if (aNumeric && bNumeric && aIdentifier.length !== bIdentifier.length) {
      return Math.sign(aIdentifier.length - bIdentifier.length);
    }
    return aIdentifier < bIdentifier ? -1 : 1;
  }
  return 0;
}

function parseVersion(value: string): RegExpExecArray | null {
  if (value.length > 64) return null;
  const match = SEMVER.exec(value);
  if (!match) return null;
  const invalidNumericIdentifier = match[4]
    ?.split('.')
    .some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier[0] === '0');
  return invalidNumericIdentifier ? null : match;
}

async function requestBounded(
  rawUrl: string,
  headers: Record<string, string>,
  limit: number,
  allowNotModified: boolean,
): Promise<{ status: number; body: string; etag?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await safeFetch(
        current,
        { method: 'GET', headers, redirect: 'manual', signal: controller.signal },
        { pinResolvedAddress: true },
      );
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (location && response.status !== 304) {
        await response.body?.cancel().catch(() => undefined);
        current = new URL(location, current).href;
        continue;
      }
      if (allowNotModified && response.status === 304) return { status: 304, body: '', etag: response.headers.get('etag') ?? undefined };
      if (!response.ok) throw new Error(`the update server answered ${response.status}`);
      return { status: response.status, body: await readBounded(response, limit), etag: response.headers.get('etag') ?? undefined };
    }
    throw new Error(`the update server redirected more than ${MAX_REDIRECTS} times`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(`the update response is larger than ${limit} bytes`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
