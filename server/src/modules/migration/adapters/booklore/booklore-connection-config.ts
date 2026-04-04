import { BadRequestException } from '@nestjs/common';
import { isAbsolute } from 'node:path';

export interface BookloreConnectionConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
  mediaRootPath?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseBookloreConnectionConfig(raw: unknown): BookloreConnectionConfig {
  if (!isObject(raw)) throw new BadRequestException('Invalid Booklore connection config: expected object');

  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  const user = typeof raw.user === 'string' ? raw.user.trim() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';
  const database = typeof raw.database === 'string' ? raw.database.trim() : '';
  const port = typeof raw.port === 'number' && Number.isFinite(raw.port) ? raw.port : 3306;
  const ssl = raw.ssl === true;
  const mediaRootPathRaw = typeof raw.mediaRootPath === 'string' ? raw.mediaRootPath.trim() : '';
  const mediaRootPath = mediaRootPathRaw.length > 0 ? mediaRootPathRaw : null;

  if (!host || !user || !database) {
    throw new BadRequestException('Invalid Booklore connection config: host, user, and database are required');
  }
  if (mediaRootPath && !isAbsolute(mediaRootPath)) {
    throw new BadRequestException('Invalid Booklore connection config: mediaRootPath must be an absolute path');
  }

  return { host, port, user, password, database, ssl, mediaRootPath };
}
