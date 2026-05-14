import { parseBookloreConnectionConfig } from '../adapters/booklore/booklore-connection-config';
import { asRecord } from './coerce';

export function parseConnectionConfig(type: string, raw: unknown): unknown {
  if (type === 'booklore' || type === 'grimmory') {
    return parseBookloreConnectionConfig(raw);
  }
  return asRecord(raw);
}

export const PASSWORD_REDACTED_SENTINEL = '********';
