import { BadRequestException } from '@nestjs/common';
import { isAbsolute } from 'node:path';

export type AudiobookshelfConnectionConfig =
  | {
      mode: 'api';
      baseUrl: string;
      apiToken: string;
      allowPrivateNetwork: boolean;
    }
  | {
      mode: 'backup';
      backupPath: string;
    };

export function parseAudiobookshelfConnectionConfig(raw: unknown): AudiobookshelfConnectionConfig {
  if (!isRecord(raw)) {
    throw new BadRequestException('Invalid Audiobookshelf connection config: expected object');
  }

  if (raw.mode === 'api') return parseApiConfig(raw);
  if (raw.mode === 'backup') return parseBackupConfig(raw);

  throw new BadRequestException('Invalid Audiobookshelf connection config: mode must be api or backup');
}

function parseApiConfig(raw: Record<string, unknown>): Extract<AudiobookshelfConnectionConfig, { mode: 'api' }> {
  const apiToken = typeof raw.apiToken === 'string' ? raw.apiToken.trim() : '';
  if (!apiToken) {
    throw new BadRequestException('Invalid Audiobookshelf connection config: apiToken is required for API mode');
  }

  const baseUrl = normalizeBaseUrl(raw.baseUrl);
  return {
    mode: 'api',
    baseUrl,
    apiToken,
    allowPrivateNetwork: raw.allowPrivateNetwork === true,
  };
}

function parseBackupConfig(raw: Record<string, unknown>): Extract<AudiobookshelfConnectionConfig, { mode: 'backup' }> {
  const backupPath = typeof raw.backupPath === 'string' ? raw.backupPath.trim() : '';
  if (!backupPath) {
    throw new BadRequestException('Invalid Audiobookshelf connection config: backupPath is required for backup mode');
  }
  if (!isAbsolute(backupPath)) {
    throw new BadRequestException('Invalid Audiobookshelf connection config: backupPath must be an absolute path');
  }
  return { mode: 'backup', backupPath };
}

function normalizeBaseUrl(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BadRequestException('Invalid Audiobookshelf connection config: baseUrl must be a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Invalid Audiobookshelf connection config: baseUrl must use http or https');
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new BadRequestException('Invalid Audiobookshelf connection config: baseUrl must contain a clean HTTP origin');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new BadRequestException('Invalid Audiobookshelf connection config: baseUrl must not contain a path');
  }

  return parsed.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
