import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { RequestCredentialService } from './request-credential.service';

function makeService(key: string | undefined) {
  return new RequestCredentialService({ get: () => key } as never);
}

const VALID_KEY = randomBytes(32).toString('hex');

describe('RequestCredentialService', () => {
  it('round-trips a secret when the key is configured', () => {
    const service = makeService(VALID_KEY);
    const ciphertext = service.encrypt('hunter2');

    expect(service.isConfigured()).toBe(true);
    expect(ciphertext).not.toContain('hunter2');
    expect(service.decrypt(ciphertext)).toBe('hunter2');
  });

  it('produces a different ciphertext each time, so equal passwords are not visibly equal', () => {
    const service = makeService(VALID_KEY);
    expect(service.encrypt('hunter2')).not.toBe(service.encrypt('hunter2'));
  });

  /**
   * The email and migration services return plaintext when their key is unset. Copying that here
   * would store tracker and seedbox passwords in the clear, so this refuses instead.
   */
  it('refuses to encrypt without a key rather than storing plaintext', () => {
    const service = makeService(undefined);
    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt('hunter2')).toThrow(BadRequestException);
  });

  it('treats a malformed key as no key at all', () => {
    const service = makeService('too-short');
    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt('hunter2')).toThrow(BadRequestException);
  });

  it('refuses to decrypt without a key', () => {
    expect(() => makeService(undefined).decrypt('anything')).toThrow(BadRequestException);
  });

  it('surfaces a rotated key as a clear refusal rather than a decode crash', () => {
    const ciphertext = makeService(VALID_KEY).encrypt('hunter2');
    const rotated = makeService(randomBytes(32).toString('hex'));

    expect(() => rotated.decrypt(ciphertext)).toThrow(BadRequestException);
  });
});
