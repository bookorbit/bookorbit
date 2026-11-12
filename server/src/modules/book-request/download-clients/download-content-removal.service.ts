import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { access, constants, lstat, readdir, rmdir, unlink } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'path';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { PathMappingService } from './path-mapping.service';

/** A download's content as the client reports it, in the client's own filesystem namespace. */
export interface ClientContent {
  /** The file itself for a single-file torrent; the torrent's own folder for a multi-file one. */
  root: string;
  /** Paths relative to `root`. Empty for a single-file torrent, whose root is its only file. */
  files: string[];
  multiFile: boolean;
  /**
   * Whether the client says it has written anything. When it has and BookOrbit finds nothing at
   * the mapped path, the mapping is wrong, and deleting nothing would leave the data behind
   * while reporting success.
   */
  expectOnDisk: boolean;
}

export interface ContentRemovalPlan {
  /** Local files to delete, each checked to sit inside the mapping it was resolved through. */
  files: string[];
  /** The torrent's own folder, removed once empty. Null for a single file. */
  topDirectory: string | null;
  /**
   * Folders inside `topDirectory` that hold no listed file, removed once empty. Only a folder
   * walk can know about them; a client's file list never names an empty folder.
   */
  directories?: string[];
}

/** A finished book release is a handful of files; anything far past that is not one job's folder. */
const MAX_FOLDER_ENTRIES = 5000;
const MAX_FOLDER_DEPTH = 16;

export interface ContentRemovalOutcome {
  deleted: number;
  failures: { path: string; code: string }[];
  /** False when the torrent's folder still holds something that was not part of the torrent. */
  topDirectoryRemoved: boolean;
}

/**
 * Deletes a download's files from BookOrbit's side, for a client that has no call to do it
 * itself. Planning and deleting are separate on purpose: everything that can be checked is
 * checked while the client still holds the download, so a removal that cannot delete the files
 * is refused before the client lets go of it rather than half done.
 *
 * Only the files the client lists are deleted, or, for a client that lists none, what is inside
 * the download's own folder. A folder is removed only once it is empty, so anything else a person
 * or another tool put beside the download is left alone.
 */
@Injectable()
export class DownloadContentRemovalService {
  private readonly logger = new Logger(DownloadContentRemovalService.name);

  constructor(private readonly pathMappings: PathMappingService) {}

  async plan(clientId: number, content: ClientContent): Promise<ContentRemovalPlan> {
    const { localPath: localRoot, containmentRoot } = await this.pathMappings.toLocalPath(clientId, content.root);
    assertNotMappedRoot(localRoot, containmentRoot);

    if (content.expectOnDisk && !(await exists(localRoot))) {
      throw new BadRequestException(
        "BookOrbit cannot find this download's files where the path mapping places them, so it cannot delete them. Check the path mapping, or remove the download without deleting its files. Nothing was removed.",
      );
    }

    const files = content.multiFile ? content.files.map((file) => join(localRoot, file)) : [localRoot];
    for (const file of files) {
      if (content.multiFile && !isInside(localRoot, file)) {
        throw new BadRequestException('The download client listed a file outside the download it belongs to');
      }
      await this.pathMappings.assertWithinRoot(containmentRoot, file);
    }

    const blocked = await firstUnwritableParent(files);
    if (blocked) {
      throw new BadRequestException(
        `BookOrbit cannot delete this download's files: it may not write to the download directory (${blocked}). Nothing was removed.`,
      );
    }

    return { files, topDirectory: content.multiFile ? localRoot : null };
  }

  /**
   * For a client that reports only the folder a finished download landed in, not its files.
   *
   * The folder is walked from BookOrbit's side through the mapping, without following links, so
   * the plan is exactly what sits there now. The caller has to have established that the folder
   * belongs to this one download: everything inside it is deleted.
   */
  async planFolder(clientId: number, remoteRoot: string): Promise<ContentRemovalPlan> {
    const { localPath: localRoot, containmentRoot } = await this.pathMappings.toLocalPath(clientId, remoteRoot);
    // Before the walk, so pointing at the whole download directory is refused for what it is
    // rather than for how many files it holds.
    assertNotMappedRoot(localRoot, containmentRoot);
    const entry = await lstatIfPresent(localRoot);
    if (!entry || !entry.isDirectory()) {
      return this.plan(clientId, { root: remoteRoot, files: [], multiFile: false, expectOnDisk: true });
    }

    const { files, directories } = await walkFolder(localRoot);
    const plan = await this.plan(clientId, { root: remoteRoot, files, multiFile: true, expectOnDisk: true });
    return { ...plan, directories: directories.map((directory) => join(localRoot, directory)) };
  }

  /**
   * Runs a plan once the client has let go of the download. Nothing is thrown past that point:
   * whatever could refuse was refused by the plan, and a removal reported as failed now would leave
   * the attempt in flight for the monitor to find missing and retry.
   */
  async executeAfterRemoval(plan: ContentRemovalPlan, context: { clientId: number; clientKey: string; label: string }): Promise<void> {
    const started = Date.now();
    this.logger.log(
      `[download_client.delete_files] [start] clientId=${context.clientId} clientKey=${context.clientKey} files=${plan.files.length} - deleting the files ${context.label} left`,
    );
    const outcome = await this.execute(plan);
    if (outcome.failures.length > 0) {
      const codes = [...new Set(outcome.failures.map((failure) => failure.code))].join(',');
      this.logger.warn(
        `[download_client.delete_files] [fail] clientId=${context.clientId} clientKey=${context.clientKey} deleted=${outcome.deleted} failed=${outcome.failures.length} durationMs=${Date.now() - started} errorClass=FilesystemError error="${sanitizeLogValue(codes)}" path="${sanitizeLogValue(outcome.failures[0].path)}" - the download was removed but some of its files remain`,
      );
      return;
    }
    this.logger.log(
      `[download_client.delete_files] [end] clientId=${context.clientId} clientKey=${context.clientKey} deleted=${outcome.deleted} folder=${plan.topDirectory ? (outcome.topDirectoryRemoved ? 'removed' : 'kept') : 'none'} durationMs=${Date.now() - started} - deleted the download's files`,
    );
  }

  async execute(plan: ContentRemovalPlan): Promise<ContentRemovalOutcome> {
    const failures: ContentRemovalOutcome['failures'] = [];
    let deleted = 0;

    for (const file of plan.files) {
      try {
        // lstat, never stat: a symlink inside the download is removed as a link, and whatever it
        // points at is left where it is.
        const entry = await lstat(file);
        if (entry.isDirectory()) {
          failures.push({ path: file, code: 'EISDIR' });
          continue;
        }
        await unlink(file);
        deleted += 1;
      } catch (error) {
        const code = errorCode(error);
        if (code !== 'ENOENT') failures.push({ path: file, code });
      }
    }

    const topDirectoryRemoved = plan.topDirectory ? await pruneEmptyDirectories(plan.topDirectory, plan.files, plan.directories ?? []) : true;
    return { deleted, failures, topDirectoryRemoved };
  }
}

/** The last segment of a path in the client's namespace, which may be Windows-style. */
export function remoteFolderName(remotePath: string): string {
  return (
    remotePath
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment.length > 0)
      .pop() ?? ''
  );
}

/**
 * A download whose folder is the mapped directory itself would make "its folder", which is pruned
 * once empty, everything the client downloads into.
 */
function assertNotMappedRoot(localRoot: string, containmentRoot: string): void {
  if (normalize(localRoot) !== normalize(containmentRoot)) return;
  throw new BadRequestException(
    "This download's folder is the mapped download directory itself, so BookOrbit will not delete it. Nothing was removed.",
  );
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return null;
    throw new BadRequestException(`BookOrbit cannot read the download directory (${code}). Nothing was removed.`);
  }
}

/** Paths relative to `root`. A link is listed as a file, so it is unlinked rather than followed. */
async function walkFolder(root: string): Promise<{ files: string[]; directories: string[] }> {
  const files: string[] = [];
  const directories: string[] = [];
  const pending: Array<{ relativeDir: string; depth: number }> = [{ relativeDir: '', depth: 0 }];

  while (pending.length > 0) {
    const { relativeDir, depth } = pending.pop()!;
    let entries;
    try {
      entries = await readdir(join(root, relativeDir), { withFileTypes: true });
    } catch (error) {
      throw new BadRequestException(`BookOrbit cannot read the download directory (${errorCode(error)}). Nothing was removed.`);
    }

    for (const entry of entries) {
      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (depth + 1 > MAX_FOLDER_DEPTH) {
          throw new BadRequestException(
            "This download's folder is nested too deeply to be one download, so BookOrbit will not delete it. Nothing was removed.",
          );
        }
        directories.push(relativePath);
        pending.push({ relativeDir: relativePath, depth: depth + 1 });
      } else {
        files.push(relativePath);
      }
      if (files.length + directories.length > MAX_FOLDER_ENTRIES) {
        throw new BadRequestException(
          "This download's folder holds too many files to be one download, so BookOrbit will not delete it. Nothing was removed.",
        );
      }
    }
  }

  return { files, directories };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return false;
    throw new BadRequestException(`BookOrbit cannot read the download directory (${code}). Nothing was removed.`);
  }
}

/**
 * Deleting a file needs write access to the folder holding it, not to the file. Folders that do
 * not exist yet hold nothing to delete.
 */
async function firstUnwritableParent(files: string[]): Promise<string | null> {
  const checked = new Set<string>();
  for (const file of files) {
    const parent = dirname(file);
    if (checked.has(parent)) continue;
    checked.add(parent);
    try {
      await access(parent, constants.W_OK);
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT') return code;
    }
  }
  return null;
}

/** Deepest first, so a nested folder is gone before its parent is tried. */
async function pruneEmptyDirectories(topDirectory: string, files: string[], extraDirectories: string[]): Promise<boolean> {
  const directories = new Set<string>(extraDirectories.filter((directory) => isInside(topDirectory, directory)));
  for (const file of files) {
    for (let current = dirname(file); isInside(topDirectory, current) && current !== topDirectory; current = dirname(current)) {
      directories.add(current);
    }
  }

  const ordered = [...directories].sort((a, b) => b.split(sep).length - a.split(sep).length);
  for (const directory of ordered) await removeIfEmpty(directory);
  return removeIfEmpty(topDirectory);
}

async function removeIfEmpty(directory: string): Promise<boolean> {
  try {
    await rmdir(directory);
    return true;
  } catch (error) {
    return errorCode(error) === 'ENOENT';
  }
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}
