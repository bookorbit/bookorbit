import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { INDEXER_ADAPTER_TYPES, type PluginInspection, type PluginInstallResult } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../../common/utils/log-sanitize.utils';
import { storageConfig } from '../../../../config/config';
import { IndexerRegistry } from '../indexer-registry';
import { IndexerRepository } from '../indexer.repository';
import { PluginLoaderService } from './plugin-loader.service';
import { assertPluginShape, isPluginTypeSlug, type DeclaredPluginShape } from './plugin-shape';

/**
 * What the child process reports back: the shape rules judge it, and the rest is what the
 * settings form needs in order to render an adapter it has never heard of.
 */
type InspectedPlugin = DeclaredPluginShape & {
  credentialKind: 'apiKey' | 'sessionId' | null;
  defaultBaseUrl: string | null;
  baseUrlHint: string | null;
};

const execFileAsync = promisify(execFile);

/** The largest plugin in existence is under 40 KB. This is room to grow, not a target. */
export const MAX_PLUGIN_BYTES = 512 * 1024;

/** Long enough for a module to evaluate, short enough that a hang is not a hang. */
const INSPECT_TIMEOUT_MS = 5_000;
/** A plugin that answers with a novel is not answering with a descriptor. */
const MAX_INSPECT_OUTPUT_BYTES = 64 * 1024;

/**
 * Imports the file and reports only what it declares about itself. Runs as its own process, so the
 * code inside never touches this one.
 */
const INSPECT_SCRIPT = `
const { pathToFileURL } = await import('node:url');
const module = await import(pathToFileURL(process.argv[1]).href);
const plugin = module.default ?? {};
process.stdout.write(
  JSON.stringify({
    apiVersion: plugin.apiVersion,
    version: plugin.version,
    type: plugin.type,
    label: plugin.label,
    requiresCredential: plugin.requiresCredential,
    credentialKind: plugin.credentialKind ?? null,
    mediaKinds: plugin.mediaKinds,
    usesCategories: plugin.usesCategories,
    seedsBack: plugin.seedsBack,
    defaultBaseUrl: plugin.defaultBaseUrl ?? null,
    baseUrlHint: plugin.baseUrlHint ?? null,
    settingsFields: plugin.settingsFields ?? [],
    hasSearch: typeof plugin.search === 'function',
    hasTest: typeof plugin.test === 'function',
    hasResolveFile: typeof plugin.resolveFile === 'function',
    hasFetchTorrentFile: typeof plugin.fetchTorrentFile === 'function',
  }),
);
`;

/**
 * Installing a plugin from the browser instead of from a shell.
 *
 * **This is remote code execution behind a permission check, and it is that by design.** A plugin
 * runs in the BookOrbit process with that process's reach, so anyone who can install one can reach
 * the database, the library and the encryption key. Before this existed, doing that required
 * filesystem access to the host; now it requires a superuser session. That is a real reduction in
 * the distance between a web request and arbitrary code, and it is why the controller enforces
 * superuser server-side rather than hiding a button.
 *
 * What can be done about it is done. A plugin is read in a child process before it is written
 * anywhere, so an upload that hangs, crashes or throws on import does none of that here. That is
 * not a sandbox: evaluating a module runs its top-level code, and in the child that code can do
 * whatever the process can. It buys three things, which is the honest claim: no handle to this
 * process's state, a deadline that ends a hang, and a shape known before the file is kept.
 */
@Injectable()
export class PluginInstallService {
  private readonly logger = new Logger(PluginInstallService.name);

  constructor(
    @Inject(storageConfig.KEY) private readonly storage: ConfigType<typeof storageConfig>,
    private readonly registry: IndexerRegistry,
    private readonly loader: PluginLoaderService,
    private readonly indexers: IndexerRepository,
  ) {}

  private get root(): string {
    return join(this.storage.appDataPath, 'plugins', 'indexers');
  }

  /**
   * What the file says it is, without keeping it. The source comes back with it so the operator can
   * read what they are about to run: one file with no dependencies is what makes that realistic,
   * and the install documentation asks them to do exactly this.
   */
  async inspect(source: string): Promise<PluginInspection> {
    assertSize(source);
    const declared = await this.declare(source);

    try {
      assertPluginShape(declared);
    } catch (error) {
      throw new BadRequestException(`That file is not a usable plugin: ${error instanceof Error ? error.message : String(error)}`);
    }

    const type = declared.type as string;
    // A plugin that claims a built-in name would be refused at the next boot and simply not appear.
    if ((INDEXER_ADAPTER_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`This install already provides an indexer called "${type}"`);
    }

    return {
      type,
      label: declared.label as string,
      ...(declared.version ? { version: declared.version as string } : {}),
      requiresCredential: declared.requiresCredential as boolean,
      credentialKind: declared.credentialKind,
      mediaKinds: declared.mediaKinds as PluginInspection['mediaKinds'],
      usesCategories: declared.usesCategories as boolean,
      seedsBack: declared.seedsBack as boolean,
      ...(declared.defaultBaseUrl ? { defaultBaseUrl: declared.defaultBaseUrl } : {}),
      ...(declared.baseUrlHint ? { baseUrlHint: declared.baseUrlHint } : {}),
      settingsFields: [...(declared.settingsFields ?? [])],
      source,
      replaces: await this.alreadyInstalled(type),
    };
  }

  /**
   * Inspected again rather than trusting what the browser was shown. The client sends the file a
   * second time to confirm, so nothing is staged between the two calls and there is no window in
   * which a checked file and an installed file could differ.
   */
  async install(source: string, installedBy: string): Promise<PluginInstallResult> {
    const inspection = await this.inspect(source);
    const directoryName = this.loader.directoryForType(inspection.type) ?? inspection.type;
    const directory = this.directoryFor(directoryName);

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.mjs'), source, 'utf8');
    const active = await this.activate(inspection.type, directoryName);

    this.logger.log(
      `[request_indexer.plugin_install] [end] type=${inspection.type} bytes=${Buffer.byteLength(source)} replaced=${inspection.replaces} ` +
        `active=${active} user="${sanitizeLogValue(installedBy)}" - plugin installed`,
    );
    return { ...inspection, active };
  }

  /**
   * Uninstalls a plugin and every source configured against it.
   *
   * Two refusals come before anything is deleted, and both matter because this deletes rows that
   * hold encrypted credentials and nothing brings them back. A built-in adapter name passes the
   * slug check on shape alone, so without the first one `DELETE .../plugins/torznab` would delete
   * every torznab source on the instance and report success. And the existence check runs against
   * a count rather than against the delete's own row count, so "does this exist" is answered
   * before, not by, the destructive write.
   */
  async remove(identifier: string, removedBy: string): Promise<void> {
    if ((INDEXER_ADAPTER_TYPES as readonly string[]).includes(identifier)) {
      throw new BadRequestException(`"${identifier}" is built into this install rather than a plugin, so it cannot be uninstalled`);
    }

    const mappedDirectory = this.loader.directoryForType(identifier);
    const directoryName = mappedDirectory ?? identifier;
    const installed = await this.directoryExists(directoryName);
    const adapterType = mappedDirectory !== undefined || isPluginTypeSlug(identifier) ? identifier : null;

    const configured = adapterType === null ? 0 : await this.indexers.countByAdapterType(adapterType);
    if (!installed && configured === 0) throw new BadRequestException(`No plugin or configured source called "${identifier}" exists`);

    const sourceCount = adapterType === null ? 0 : await this.indexers.deleteByAdapterType(adapterType);
    await rm(this.directoryFor(directoryName), { recursive: true, force: true });
    if (adapterType !== null) {
      this.registry.unregister(adapterType);
      this.loader.forgetPlugin(adapterType);
    }
    this.loader.forgetFailure(directoryName);
    this.logger.log(
      `[request_indexer.plugin_install] [end] identifier="${sanitizeLogValue(identifier)}" directory="${sanitizeLogValue(directoryName)}" ` +
        `sources=${sourceCount} user="${sanitizeLogValue(removedBy)}" - plugin and sources removed`,
    );
  }

  /**
   * Puts a freshly written plugin to work in this process. It has already been imported once in a
   * child, so the usual reason to fail is a module that behaves differently the second time; that
   * leaves the file installed and the operator with a restart to fall back on, which is worth
   * saying rather than failing the install that did in fact write the file.
   */
  private async activate(type: string, directory: string): Promise<boolean> {
    try {
      this.registry.register(await this.loader.loadDirectory(directory));
      this.loader.forgetFailure(directory);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[request_indexer.plugin_install] [fail] type=${type} error="${sanitizeLogValue(reason)}" - plugin written but not loaded, a restart will retry`,
      );
      return false;
    }
  }

  /** A failed disk-installed plugin can have any directory name, so containment is enforced here. */
  private directoryFor(name: string): string {
    if (name.includes('/') || name.includes('\0')) throw new BadRequestException('That plugin name is not usable as a directory');
    const directory = resolve(this.root, name);
    if (!directory.startsWith(resolve(this.root) + '/')) throw new BadRequestException('That plugin name is not usable as a directory');
    return directory;
  }

  private async alreadyInstalled(type: string): Promise<boolean> {
    return this.directoryExists(this.loader.directoryForType(type) ?? type);
  }

  private async directoryExists(name: string): Promise<boolean> {
    try {
      const { stat } = await import('node:fs/promises');
      return (await stat(this.directoryFor(name))).isDirectory();
    } catch {
      return false;
    }
  }

  /** Runs the upload in a process of its own and reads back only what it declares. */
  private async declare(source: string): Promise<InspectedPlugin> {
    const staging = await mkdtemp(join(tmpdir(), 'bookorbit-plugin-'));
    const candidate = join(staging, 'index.mjs');

    try {
      await writeFile(candidate, source, 'utf8');
      const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', INSPECT_SCRIPT, candidate], {
        timeout: INSPECT_TIMEOUT_MS,
        maxBuffer: MAX_INSPECT_OUTPUT_BYTES,
        // Nothing of this process's environment, so a plugin cannot read a secret out of it while
        // being inspected. It gets the environment it will actually run with at load time instead.
        env: { PATH: process.env.PATH ?? '' },
      });
      return JSON.parse(stdout) as InspectedPlugin;
    } catch (error) {
      throw new BadRequestException(`That file could not be read as a plugin: ${describe(error)}`);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

function assertSize(source: string): void {
  const bytes = Buffer.byteLength(source);
  if (bytes === 0) throw new BadRequestException('That file is empty');
  if (bytes > MAX_PLUGIN_BYTES) throw new BadRequestException(`That file is ${bytes} bytes, past the ${MAX_PLUGIN_BYTES} byte limit`);
}

/**
 * Node's exit code 13 is an unsettled top-level await: the module simply never finished, and the
 * process ends at once rather than being killed. A module that blocks the event loop instead runs
 * out the deadline and is killed. Both mean the same thing to an operator.
 */
const UNFINISHED_TOP_LEVEL_AWAIT = 13;

/**
 * The reason a module refused to load, in the words it used.
 *
 * Read out of the middle of stderr rather than off the end of it: Node prints the offending source
 * line, then the error, then a stack and its own version banner, so the last line is "Node.js
 * v24.14.0" and the useful one is above it.
 */
const NODE_ERROR_LINE = /^[A-Za-z]*Error(?: \[[^\]]+\])?:\s*(.+)$/m;

function describe(error: unknown): string {
  const failure = error as { killed?: boolean; code?: number | string; stderr?: string } | null;

  if (failure?.killed || failure?.code === UNFINISHED_TOP_LEVEL_AWAIT) {
    return `it did not finish loading within ${INSPECT_TIMEOUT_MS}ms`;
  }

  const stderr = String(failure?.stderr ?? '');
  const stated = NODE_ERROR_LINE.exec(stderr)?.[1]?.trim();
  if (stated) return stated.slice(0, 200);

  const fallback = stderr.trim().split('\n').filter(Boolean)[0];
  return fallback ? fallback.slice(0, 200) : error instanceof Error ? error.message : String(error);
}
