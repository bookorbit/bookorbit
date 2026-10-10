import { BadRequestException } from '@nestjs/common';
import { posix, win32 } from 'node:path';
import { REGEX_METADATA_LIMITS } from '@bookorbit/types';

export function prepareRegexMetadataPath(relativePath: string): string {
  const path = relativePath.replaceAll('\\', '/');
  if (
    !path ||
    path.length > REGEX_METADATA_LIMITS.pathLength ||
    path.includes('\0') ||
    posix.isAbsolute(path) ||
    win32.isAbsolute(path) ||
    /^[a-z]:/i.test(path) ||
    path.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new BadRequestException('Expected a file path relative to the library folder');
  }
  const extension = /\.kepub\.epub$/i.test(path) ? path.slice(-11) : posix.extname(path);
  return extension ? path.slice(0, -extension.length) : path;
}
