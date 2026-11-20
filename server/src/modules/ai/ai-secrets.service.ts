import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { decryptAesGcm, encryptAesGcm, parseAesGcmKey } from '../../common/secrets/aes-gcm-secret';

const HINT_LENGTH = 4;

export interface AiHeaderSecret {
  name: string;
  value: string;
}

/**
 * Provider keys and header values, encrypted with `AI_ENCRYPTION_KEY`.
 *
 * Follows the book request credentials rather than the TTS provider: without the env var a key is
 * refused, never stored in the clear. Reading never throws, because a key that no longer decrypts
 * is a state of the connection ("enter it again"), not a crash halfway through a job.
 */
@Injectable()
export class AiSecretsService {
  private readonly logger = new Logger(AiSecretsService.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('ai.encryptionKey') ?? '';
    this.key = parseAesGcmKey(raw);
    if (!this.key && raw.length > 0) {
      this.logger.warn('AI_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). AI provider keys cannot be stored.');
    }
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new BadRequestException({
        message: 'Set AI_ENCRYPTION_KEY before saving a provider key or header value. Generate one with: openssl rand -hex 32',
        errorCode: 'AI_ENCRYPTION_KEY_MISSING',
      });
    }
    return encryptAesGcm(this.key, plaintext);
  }

  /** Null when the env var is unset, or changed since the value was written. */
  decrypt(ciphertext: string): string | null {
    if (!this.key) return null;
    try {
      return decryptAesGcm(this.key, ciphertext);
    } catch {
      return null;
    }
  }

  sealHeaders(headers: AiHeaderSecret[]): string | null {
    return headers.length === 0 ? null : this.encrypt(JSON.stringify(headers));
  }

  /** Null when the stored headers cannot be read. */
  openHeaders(ciphertext: string | null): AiHeaderSecret[] | null {
    if (!ciphertext) return [];
    const plaintext = this.decrypt(ciphertext);
    if (plaintext === null) return null;
    try {
      const parsed: unknown = JSON.parse(plaintext);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (entry): entry is AiHeaderSecret =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as AiHeaderSecret).name === 'string' &&
          typeof (entry as AiHeaderSecret).value === 'string',
      );
    } catch {
      return null;
    }
  }

  static hint(secret: string): string {
    return secret.length <= HINT_LENGTH ? '' : secret.slice(-HINT_LENGTH);
  }
}
