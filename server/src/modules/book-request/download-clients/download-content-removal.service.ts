import { BadRequestException, Injectable } from '@nestjs/common';
import { access, constants, lstat, rmdir, unlink } from 'fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'path';

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
}

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
 * Only the files the client lists are deleted. A folder is removed only once it is empty, so
 * anything else a person or another tool put beside the download is left alone.
 */
@Injectable()
export class DownloadContentRemovalService {
  constructor(private readonly pathMappings: PathMappingService) {}

  async plan(clientId: number, content: ClientContent): Promise<ContentRemovalPlan> {
    const { localPath: localRoot, containmentRoot } = await this.pathMappings.toLocalPath(clientId, content.root);
    // A torrent whose folder is the mapped directory itself would make "its folder", which is
    // pruned once empty, everything the client downloads into.
    if (normalize(localRoot) === normalize(containmentRoot)) {
      throw new BadRequestException(
        "This download's folder is the mapped download directory itself, so BookOrbit will not delete it. Nothing was removed.",
      );
    }

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

    const topDirectoryRemoved = plan.topDirectory ? await pruneEmptyDirectories(plan.topDirectory, plan.files) : true;
    return { deleted, failures, topDirectoryRemoved };
  }
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
async function pruneEmptyDirectories(topDirectory: string, files: string[]): Promise<boolean> {
  const directories = new Set<string>();
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
