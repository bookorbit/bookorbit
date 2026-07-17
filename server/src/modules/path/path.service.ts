import type { CreateFolderResult, DirectoryEntry, PathConfig } from '@bookorbit/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { lstat, mkdir, readdir } from 'fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'path';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PathPolicyService } from './path-policy.service';

const BLOCKED = ['/proc', '/sys', '/dev', '/run', '/var/run', '/etc', '/root'];

@Injectable()
export class PathService {
  private readonly logger = new Logger(PathService.name);

  constructor(private readonly pathPolicy: PathPolicyService) {}

  getConfig(): PathConfig {
    return { root: this.pathPolicy.getBrowseRoot() };
  }

  async listDirectories(rawPath?: string): Promise<DirectoryEntry[]> {
    const browseRoot = resolve(this.pathPolicy.getBrowseRoot());
    const resolved = resolve(await this.pathPolicy.resolveBrowsePath(rawPath));
    const relativePath = relative(browseRoot, resolved);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return [];

    if (this.isBlocked(resolved)) {
      return [];
    }
    try {
      const rootStat = await lstat(resolved);
      if (rootStat.isSymbolicLink()) return [];

      const entries = await readdir(resolved, { withFileTypes: true });
      const dirs: DirectoryEntry[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.')) continue;
        const full = join(resolved, entry.name);
        dirs.push({ name: entry.name, path: full });
      }
      return dirs.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async createDirectory(rawParent: string, rawName: string): Promise<CreateFolderResult> {
    const name = this.assertSafeName(rawName);
    const browseRoot = resolve(this.pathPolicy.getBrowseRoot());
    const parent = resolve(await this.pathPolicy.resolveBrowsePath(rawParent));
    const relativeParent = relative(browseRoot, parent);
    if (relativeParent === '..' || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent)) {
      throw new ForbiddenException('Cannot create a folder outside the configured library browse root');
    }

    if (this.isBlocked(parent)) {
      throw new ForbiddenException('Cannot create a folder in this location');
    }

    const startedAt = Date.now();
    this.logger.log(`[path.create_folder] [start] parentPath="${sanitizeLogValue(parent)}" name="${sanitizeLogValue(name)}" - create folder started`);
    try {
      const parentStat = await lstat(parent);
      if (parentStat.isSymbolicLink()) throw new ForbiddenException('Cannot create a folder under a symbolic link');
      if (!parentStat.isDirectory()) throw new BadRequestException('Parent path is not a directory');

      const target = join(parent, name);
      const resolvedTarget = resolve(target);
      const relativeTarget = relative(parent, resolvedTarget);
      if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
        throw new BadRequestException('Invalid folder name');
      }
      await this.pathPolicy.assertWithinBrowseRoot(resolvedTarget);

      await mkdir(resolvedTarget);
      this.logger.log(
        `[path.create_folder] [end] path="${sanitizeLogValue(resolvedTarget)}" durationMs=${Date.now() - startedAt} - create folder completed`,
      );
      return { name, path: resolvedTarget };
    } catch (error) {
      this.logger.warn(
        `[path.create_folder] [fail] parentPath="${sanitizeLogValue(parent)}" name="${sanitizeLogValue(name)}" durationMs=${Date.now() - startedAt} errorClass=${getErrorClass(error)} error="${sanitizeLogValue(getErrorMessage(error))}" - create folder failed`,
      );
      throw this.mapCreateError(error);
    }
  }

  private isBlocked(resolved: string): boolean {
    return BLOCKED.some((b) => resolved === b || resolved.startsWith(b + sep));
  }

  private assertSafeName(rawName: string): string {
    const name = (rawName ?? '').trim();
    const safeName = basename(name);
    if (!name) throw new BadRequestException('Folder name is required');
    if (safeName !== name || safeName.includes('/') || safeName.includes('\\') || safeName.includes(sep)) {
      throw new BadRequestException('Folder name cannot contain path separators');
    }
    if (safeName === '.' || safeName === '..' || safeName.startsWith('.')) {
      throw new BadRequestException('Folder name cannot start with a dot');
    }
    if (safeName.includes('\0')) throw new BadRequestException('Folder name contains invalid characters');
    return safeName;
  }

  private mapCreateError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    switch (getErrorCode(error)) {
      case 'EEXIST':
        return new ConflictException('A folder with that name already exists');
      case 'EACCES':
      case 'EPERM':
        return new ForbiddenException('Permission denied');
      case 'EROFS':
        return new BadRequestException('The filesystem is read-only');
      case 'ENOENT':
        return new BadRequestException('Parent folder no longer exists');
      default:
        return new InternalServerErrorException('Could not create the folder');
    }
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'Error';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
