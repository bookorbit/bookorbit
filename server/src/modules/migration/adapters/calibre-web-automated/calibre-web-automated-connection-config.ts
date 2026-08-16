import { BadRequestException } from '@nestjs/common';
import { isAbsolute } from 'node:path';

export interface CalibreWebAutomatedConnectionConfig {
  mode: 'snapshot';
  appDatabasePath: string;
  metadataDatabasePath: string;
}

export function parseCalibreWebAutomatedConnectionConfig(raw: unknown): CalibreWebAutomatedConnectionConfig {
  if (!isRecord(raw)) {
    throw new BadRequestException('Invalid Calibre-Web Automated connection config: expected object');
  }
  if (raw.mode !== 'snapshot') {
    throw new BadRequestException('Invalid Calibre-Web Automated connection config: mode must be snapshot');
  }

  const appDatabasePath = requiredAbsolutePath(raw.appDatabasePath, 'appDatabasePath');
  const metadataDatabasePath = requiredAbsolutePath(raw.metadataDatabasePath, 'metadataDatabasePath');
  return { mode: 'snapshot', appDatabasePath, metadataDatabasePath };
}

function requiredAbsolutePath(value: unknown, field: string): string {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path) {
    throw new BadRequestException(`Invalid Calibre-Web Automated connection config: ${field} is required`);
  }
  if (!isAbsolute(path)) {
    throw new BadRequestException(`Invalid Calibre-Web Automated connection config: ${field} must be an absolute path`);
  }
  return path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
