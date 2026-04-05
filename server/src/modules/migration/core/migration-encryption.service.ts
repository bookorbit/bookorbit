import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENCRYPTED_MARKER = '_encrypted';

@Injectable()
export class MigrationEncryptionService {
  private readonly logger = new Logger(MigrationEncryptionService.name);
  private readonly key: Buffer | null;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('migration.encryptionKey') ?? '';
    if (raw.length === 64) {
      this.key = Buffer.from(raw, 'hex');
    } else if (raw.length > 0) {
      this.logger.warn('MIGRATION_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Connection configs will not be encrypted.');
      this.key = null;
    } else {
      this.key = null;
    }
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encryptConfig(config: Record<string, unknown>): Record<string, unknown> {
    if (!this.key) return config;
    const plaintext = JSON.stringify(config);
    return { [ENCRYPTED_MARKER]: this.encrypt(plaintext) };
  }

  decryptConfig(stored: unknown): Record<string, unknown> {
    if (!stored || typeof stored !== 'object') return {};
    const obj = stored as Record<string, unknown>;

    if (typeof obj[ENCRYPTED_MARKER] !== 'string') return obj;
    if (!this.key) {
      this.logger.warn('Encrypted config found but no encryption key configured. Cannot decrypt.');
      return obj;
    }

    const decrypted = this.decrypt(obj[ENCRYPTED_MARKER] as string);
    return JSON.parse(decrypted) as Record<string, unknown>;
  }

  private encrypt(plaintext: string): string {
    if (!this.key) return plaintext;

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(ciphertext: string): string {
    if (!this.key) return ciphertext;

    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
