import { createHash, randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';

import { API_KEY_PREFIX } from '@bookorbit/types';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SECRET_BYTES = 32;
/** 62^43 exceeds 2^256, so 32 random bytes always fit in 43 characters. */
const SECRET_LENGTH = 43;
/** 62^6 exceeds 2^32, so a CRC32 always fits in 6 characters. */
const CHECKSUM_LENGTH = 6;
const HINT_LENGTH = 4;
const TOKEN_LENGTH = API_KEY_PREFIX.length + SECRET_LENGTH + CHECKSUM_LENGTH;
const TOKEN_SHAPE = new RegExp(`^${API_KEY_PREFIX}[0-9A-Za-z]{${SECRET_LENGTH + CHECKSUM_LENGTH}}$`);

function toBase62(value: bigint, length: number): string {
  let out = '';
  let rest = value;
  while (rest > 0n) {
    out = BASE62[Number(rest % 62n)] + out;
    rest /= 62n;
  }
  return out.padStart(length, '0');
}

function checksumOf(body: string): string {
  return toBase62(BigInt(crc32(body)), CHECKSUM_LENGTH);
}

export function generateApiKeyToken(): string {
  const secret = toBase62(BigInt(`0x${randomBytes(SECRET_BYTES).toString('hex')}`), SECRET_LENGTH);
  const body = `${API_KEY_PREFIX}${secret}`;
  return `${body}${checksumOf(body)}`;
}

/** Whether a credential is meant to be an API key, before deciding whether it is a valid one. */
export function isApiKeyShaped(raw: string): boolean {
  return raw.startsWith(API_KEY_PREFIX);
}

/** Rejects typos and garbage without touching the database. */
export function hasValidApiKeyChecksum(raw: string): boolean {
  if (raw.length !== TOKEN_LENGTH || !TOKEN_SHAPE.test(raw)) return false;
  const body = raw.slice(0, -CHECKSUM_LENGTH);
  return checksumOf(body) === raw.slice(-CHECKSUM_LENGTH);
}

/**
 * A plain SHA-256: the secret already carries 256 bits, so a slow hash would cost CPU on every
 * request and buy nothing. No pepper either, because rotating it would silently kill every key.
 */
export function hashApiKeyToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function apiKeyHint(raw: string): string {
  return raw.slice(-HINT_LENGTH);
}
