import type { ConfigType } from '@nestjs/config';
import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { realpath } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';

import { storageConfig } from '../../config/config';

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
    const path = resolve(rawPath?.trim() || this.browseRoot);
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
    const [root, path] = await Promise.all([this.getCanonicalBrowseRoot(), canonicalizeWithExistingAncestor(resolve(rawPath))]);
    return isSameOrChildPath(root, path);
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
      const canonical = await realpath(current); // codeql[js/path-injection]
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

function isSameOrChildPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
