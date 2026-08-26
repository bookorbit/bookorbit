import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_HEX_LENGTH = 64;

/**
 * Shared by every part of this feature that holds a third-party secret, so the "refuse without a
 * key" rule lives in exactly one place.
 *
 * `EmailEncryptionService` and `MigrationEncryptionService` both return plaintext when their key
 * is unset. That is deliberately not copied here: a tracker or seedbox password stored in the
 * clear is a worse outcome than a settings page that will not save.
 */
@Injectable()
export class RequestCredentialService {
  private readonly logger = new Logger(RequestCredentialService.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('bookRequest.encryptionKey') ?? '';
    if (raw.length === KEY_HEX_LENGTH && /^[0-9a-f]+$/i.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      if (raw.length > 0) {
        this.logger.warn('BOOK_REQUEST_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Credentials cannot be stored.');
      }
      this.key = null;
    }
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new BadRequestException({
        message: 'Set BOOK_REQUEST_ENCRYPTION_KEY before saving credentials. Generate one with: openssl rand -hex 32',
        errorCode: 'REQUEST_ENCRYPTION_KEY_MISSING',
      });
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  /**
   * A key that has been rotated or removed leaves rows nobody can read. That surfaces as a
   * refusal to use the client rather than a decode crash halfway through a download tick.
   */
  decrypt(ciphertext: string): string {
    if (!this.key) {
      throw new BadRequestException({
        message: 'BOOK_REQUEST_ENCRYPTION_KEY is not set, so stored credentials cannot be read',
        errorCode: 'REQUEST_ENCRYPTION_KEY_MISSING',
      });
    }

    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      throw new BadRequestException({
        message: 'Stored credentials could not be decrypted. BOOK_REQUEST_ENCRYPTION_KEY may have changed.',
        errorCode: 'REQUEST_ENCRYPTION_KEY_CHANGED',
      });
    }
  }
}
