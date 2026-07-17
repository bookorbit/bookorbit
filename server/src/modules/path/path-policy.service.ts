import type { ConfigType } from '@nestjs/config';
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { realpath } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';

import { storageConfig } from '../../config/config';

const MAX_BROWSE_PATH_LENGTH = 4096;

@Injectable()
export class PathPolicyService {
  private readonly browseRoot: string;
  private canonicalBrowseRootPromise: Promise<string> | null = null;

  constructor(@Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>) {
    this.browseRoot = resolve(storage.libraryBrowseRoot);
  }

  getBrowseRoot(): string {
    return this.browseRoot;
  }

  async resolveBrowsePath(rawPath?: string | null): Promise<string> {
    const inputPath = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (inputPath.length > MAX_BROWSE_PATH_LENGTH) throw new BadRequestException('Path is too long');

    const path = resolve(inputPath || this.browseRoot);
    await this.assertWithinBrowseRoot(path);
    return path;
  }

  async assertWithinBrowseRoot(rawPath: string): Promise<string> {
    const path = resolve(rawPath);
    if (!(await this.isWithinBrowseRoot(path))) {
      throw new ForbiddenException('Path is outside the configured library browse root');
    }
    return path;
  }

  async isWithinBrowseRoot(rawPath: string): Promise<boolean> {
    if (typeof rawPath !== 'string' || rawPath.length > MAX_BROWSE_PATH_LENGTH) return false;

    const resolvedPath = resolve(rawPath);
    const lexicalRelativePath = relative(this.browseRoot, resolvedPath);
    if (lexicalRelativePath === '..' || lexicalRelativePath.startsWith(`..${sep}`) || isAbsolute(lexicalRelativePath)) return false;

    const suffixSegments: string[] = [];
    let current = resolvedPath;
    let canonicalPath: string;

    while (true) {
      try {
        const canonicalAncestor = await realpath(current);
        canonicalPath = suffixSegments.reduceRight((built, segment) => join(built, segment), canonicalAncestor);
        break;
      } catch (error) {
        const code = getErrorCode(error);
        if (code !== 'ENOENT' && code !== 'ENOTDIR') return false;
      }

      const parent = dirname(current);
      if (parent === current) return false;

      suffixSegments.push(basename(current));
      current = parent;
    }

    const root = await this.getCanonicalBrowseRoot();
    const canonicalRelativePath = relative(root, canonicalPath);
    return (
      canonicalRelativePath === '' ||
      (!canonicalRelativePath.startsWith(`..${sep}`) && canonicalRelativePath !== '..' && !isAbsolute(canonicalRelativePath))
    );
  }

  private getCanonicalBrowseRoot(): Promise<string> {
    this.canonicalBrowseRootPromise ??= canonicalizeWithExistingAncestor(this.browseRoot);
    return this.canonicalBrowseRootPromise;
  }
}

async function canonicalizeWithExistingAncestor(resolvedPath: string): Promise<string> {
  const suffixSegments: string[] = [];
  let current = resolvedPath;

  while (true) {
    try {
      const canonical = await realpath(current);
      return suffixSegments.reduceRight((built, segment) => join(built, segment), canonical);
    } catch (error) {
      const code = getErrorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return resolvedPath;
      }
    }

    const parent = dirname(current);
    if (parent === current) return resolvedPath;

    suffixSegments.push(basename(current));
    current = parent;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
