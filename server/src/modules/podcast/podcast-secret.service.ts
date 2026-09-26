import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { podcastConfig } from '../../config/config';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class PodcastSecretService {
  private readonly key: Buffer;

  constructor(@Inject(podcastConfig.KEY) config: ConfigType<typeof podcastConfig>) {
    const raw = config.encryptionKey;
    this.key = createHash('sha256').update(raw, 'utf8').digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
  }

  decrypt(value: string): string {
    try {
      const [version, ivEncoded, tagEncoded, ciphertextEncoded] = value.split(':');
      if (version !== 'v1' || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new InternalServerErrorException();
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivEncoded, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new InternalServerErrorException('Podcast secret could not be decrypted');
    }
  }

  hashUrl(value: string): string {
    return createHash('sha256').update(this.normalizeUrl(value), 'utf8').digest('hex');
  }

  redactUrl(value: string): string {
    try {
      const url = new URL(value);
      return url.origin;
    } catch {
      return '[invalid-url]';
    }
  }

  normalizeUrl(value: string): string {
    const url = new URL(value.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
    return url.toString();
  }
}
