import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_HEX_LENGTH = 64;

/** A 64-character hex string as a 32-byte key, or null when it is unset or malformed. */
export function parseAesGcmKey(raw: string | undefined | null): Buffer | null {
  const value = raw ?? '';
  return value.length === KEY_HEX_LENGTH && /^[0-9a-f]+$/i.test(value) ? Buffer.from(value, 'hex') : null;
}

/** `iv | tag | ciphertext`, base64. */
export function encryptAesGcm(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

/** Throws when the blob was written with another key or has been tampered with. */
export function decryptAesGcm(key: Buffer, ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, buf.subarray(0, IV_LENGTH));
  decipher.setAuthTag(buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  return Buffer.concat([decipher.update(buf.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
}
