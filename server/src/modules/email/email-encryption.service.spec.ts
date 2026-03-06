import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailEncryptionService } from './email-encryption.service';

describe('EmailEncryptionService', () => {
  let service: EmailEncryptionService;
  let config: ConfigService;

  const MOCK_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailEncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailEncryptionService>(EmailEncryptionService);
    config = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isConfigured', () => {
    it('should return true if key is valid (64 hex chars)', () => {
      (config.get as jest.Mock).mockReturnValue(MOCK_KEY);
      const s = new EmailEncryptionService(config);
      expect(s.isConfigured()).toBe(true);
    });

    it('should return false if key is missing', () => {
      (config.get as jest.Mock).mockReturnValue(null);
      const s = new EmailEncryptionService(config);
      expect(s.isConfigured()).toBe(false);
    });

    it('should return false if key is wrong length', () => {
      (config.get as jest.Mock).mockReturnValue('too-short');
      const s = new EmailEncryptionService(config);
      expect(s.isConfigured()).toBe(false);
    });
  });

  describe('encrypt/decrypt', () => {
    beforeEach(() => {
      (config.get as jest.Mock).mockReturnValue(MOCK_KEY);
      service = new EmailEncryptionService(config);
    });

    it('should encrypt and decrypt a string back to original', () => {
      const original = 'my-secret-password';
      const encrypted = service.encrypt(original);
      expect(encrypted).not.toBe(original);
      expect(typeof encrypted).toBe('string');

      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should return plaintext if not configured', () => {
      (config.get as jest.Mock).mockReturnValue(null);
      const s = new EmailEncryptionService(config);
      const original = 'plain';
      expect(s.encrypt(original)).toBe(original);
      expect(s.decrypt(original)).toBe(original);
    });

    it('should produce different ciphertext for same plaintext (IV)', () => {
      const original = 'same-thing';
      const enc1 = service.encrypt(original);
      const enc2 = service.encrypt(original);
      expect(enc1).not.toBe(enc2);
      expect(service.decrypt(enc1)).toBe(original);
      expect(service.decrypt(enc2)).toBe(original);
    });

    it('should throw error if decryption fails (e.g., tampered)', () => {
      const original = 'tamper-me';
      const encrypted = service.encrypt(original);
      const buf = Buffer.from(encrypted, 'base64');
      buf[buf.length - 1] ^= 1; // Flip a bit in the encrypted part or tag
      const tampered = buf.toString('base64');

      expect(() => service.decrypt(tampered)).toThrow();
    });
  });
});
