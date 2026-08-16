import { parseBookloreConnectionConfig } from '../adapters/booklore/booklore-connection-config';
import { parseAudiobookshelfConnectionConfig } from '../adapters/audiobookshelf/audiobookshelf-connection-config';
import { parseCalibreWebAutomatedConnectionConfig } from '../adapters/calibre-web-automated/calibre-web-automated-connection-config';
import { asRecord } from './coerce';

export function parseConnectionConfig(type: string, raw: unknown): unknown {
  const normalizedType = type.trim().toLowerCase();
  if (normalizedType === 'audiobookshelf') {
    return parseAudiobookshelfConnectionConfig(raw);
  }
  if (normalizedType === 'calibre_web_automated') {
    return parseCalibreWebAutomatedConnectionConfig(raw);
  }
  if (normalizedType === 'booklore' || normalizedType === 'grimmory') {
    return parseBookloreConnectionConfig(raw);
  }
  return asRecord(raw);
}

export const PASSWORD_REDACTED_SENTINEL = '********';
