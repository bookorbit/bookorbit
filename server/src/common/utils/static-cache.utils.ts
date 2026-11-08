import type { FastifyReply } from 'fastify';
import { dirname, join, relative } from 'path';

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const PACKAGE_VERSION_SEGMENT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Only files whose URL changes with their content may be cached forever: the bundler's hashed
 * output sits directly in `assets/`, and Lucide icon files sit in a folder named after the package
 * version. Folders copied from `client/public/assets/` keep fixed file names (the Foliate reader
 * engine is loaded from `/assets/foliate/view.js`), so they must keep revalidating.
 */
export function isImmutableStaticAsset(publicRoot: string, filePath: string): boolean {
  const assetsDir = join(publicRoot, 'assets');
  const fileDir = dirname(filePath);
  if (fileDir === assetsDir) return true;
  return PACKAGE_VERSION_SEGMENT.test(relative(join(assetsDir, 'lucide'), fileDir));
}

/** `@fastify/static` 10 hands `setHeaders` the Fastify reply, so the header goes through `reply.header`. */
export function applyStaticCacheHeaders(reply: FastifyReply, publicRoot: string, filePath: string): void {
  if (isImmutableStaticAsset(publicRoot, filePath)) {
    reply.header('cache-control', IMMUTABLE_CACHE_CONTROL);
  }
}
