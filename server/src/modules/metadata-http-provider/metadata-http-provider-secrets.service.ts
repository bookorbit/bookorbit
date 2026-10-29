import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { decryptAesGcm, encryptAesGcm, parseAesGcmKey } from '../../common/secrets/aes-gcm-secret';

/**
 * Keeps a provider's `Authorization` header encrypted at rest with the same key book requests use
 * for tracker and download-client credentials, so there is one key to set and one error to explain.
 * A provider that needs no header works without the key.
 */
@Injectable()
export class MetadataHttpProviderSecrets {
  private readonly logger = new Logger(MetadataHttpProviderSecrets.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    this.key = parseAesGcmKey(config.get<string>('bookRequest.encryptionKey'));
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new BadRequestException({
        message: 'Set BOOK_REQUEST_ENCRYPTION_KEY before saving an authorization header. Generate one with: openssl rand -hex 32',
        errorCode: 'REQUEST_ENCRYPTION_KEY_MISSING',
      });
    }
    return encryptAesGcm(this.key, plaintext);
  }

  /** Null when the key is missing or changed: the provider is then treated as unconfigured, not crashed on. */
  decrypt(ciphertext: string, providerKey: string): string | null {
    if (!this.key) {
      this.logger.warn(`[http_provider.secret] [fail] provider=${providerKey} errorClass=MissingKey - BOOK_REQUEST_ENCRYPTION_KEY is not set`);
      return null;
    }
    try {
      return decryptAesGcm(this.key, ciphertext);
    } catch {
      this.logger.warn(`[http_provider.secret] [fail] provider=${providerKey} errorClass=DecryptError - authorization could not be decrypted`);
      return null;
    }
  }
}
