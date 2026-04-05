import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MigrationEncryptionService } from './migration-encryption.service';

describe('MigrationEncryptionService', () => {
  let config: ConfigService;

  const MOCK_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  function buildService(keyValue: string | null): MigrationEncryptionService {
    (config.get as ReturnType<typeof vi.fn>).mockReturnValue(keyValue);
    return new MigrationEncryptionService(config);
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationEncryptionService,
        {
          provide: ConfigService,
          useValue: { get: vi.fn() },
        },
      ],
    }).compile();

    config = module.get<ConfigService>(ConfigService);
  });

  describe('isConfigured', () => {
    it('returns true when key is valid 64-char hex', () => {
      expect(buildService(MOCK_KEY).isConfigured()).toBe(true);
    });

    it('returns false when key is missing', () => {
      expect(buildService(null).isConfigured()).toBe(false);
    });

    it('returns false when key is wrong length', () => {
      expect(buildService('too-short').isConfigured()).toBe(false);
    });
  });

  describe('encryptConfig / decryptConfig', () => {
    it('encrypts and decrypts a config object round-trip', () => {
      const service = buildService(MOCK_KEY);
      const original = { host: 'localhost', port: 5432, password: 'secret' };

      const encrypted = service.encryptConfig(original);
      expect(encrypted).toHaveProperty('_encrypted');
      expect(typeof encrypted._encrypted).toBe('string');
      expect(encrypted).not.toHaveProperty('host');

      const decrypted = service.decryptConfig(encrypted);
      expect(decrypted).toEqual(original);
    });

    it('returns config as-is when key is not configured', () => {
      const service = buildService(null);
      const original = { host: 'localhost', password: 'secret' };

      const encrypted = service.encryptConfig(original);
      expect(encrypted).toEqual(original);
      expect(encrypted).not.toHaveProperty('_encrypted');
    });

    it('decrypts plain (unencrypted) config objects for backward compatibility', () => {
      const service = buildService(MOCK_KEY);
      const plain = { host: 'localhost', password: 'secret' };

      const decrypted = service.decryptConfig(plain);
      expect(decrypted).toEqual(plain);
    });

    it('produces different ciphertext for the same config (random IV)', () => {
      const service = buildService(MOCK_KEY);
      const original = { key: 'value' };

      const enc1 = service.encryptConfig(original);
      const enc2 = service.encryptConfig(original);
      expect(enc1._encrypted).not.toBe(enc2._encrypted);

      expect(service.decryptConfig(enc1)).toEqual(original);
      expect(service.decryptConfig(enc2)).toEqual(original);
    });

    it('throws on tampered ciphertext', () => {
      const service = buildService(MOCK_KEY);
      const encrypted = service.encryptConfig({ password: 'secret' });

      const buf = Buffer.from(encrypted._encrypted as string, 'base64');
      buf[buf.length - 1] ^= 1;
      const tampered = { _encrypted: buf.toString('base64') };

      expect(() => service.decryptConfig(tampered)).toThrow();
    });

    it('handles null/undefined stored values gracefully', () => {
      const service = buildService(MOCK_KEY);
      expect(service.decryptConfig(null)).toEqual({});
      expect(service.decryptConfig(undefined)).toEqual({});
    });

    it('handles complex nested config objects', () => {
      const service = buildService(MOCK_KEY);
      const original = {
        host: 'db.example.com',
        port: 3306,
        credentials: { user: 'admin', password: 's3cret!' },
        tags: ['prod', 'primary'],
      };

      const decrypted = service.decryptConfig(service.encryptConfig(original));
      expect(decrypted).toEqual(original);
    });
  });
});
