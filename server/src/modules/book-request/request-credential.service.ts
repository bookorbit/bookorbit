import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { decryptAesGcm, encryptAesGcm, parseAesGcmKey } from '../../common/secrets/aes-gcm-secret';

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
    this.key = parseAesGcmKey(raw);
    if (!this.key && raw.length > 0) {
      this.logger.warn('BOOK_REQUEST_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Credentials cannot be stored.');
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

    return encryptAesGcm(this.key, plaintext);
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

    try {
      return decryptAesGcm(this.key, ciphertext);
    } catch {
      throw new BadRequestException({
        message: 'Stored credentials could not be decrypted. BOOK_REQUEST_ENCRYPTION_KEY may have changed.',
        errorCode: 'REQUEST_ENCRYPTION_KEY_CHANGED',
      });
    }
  }
}
