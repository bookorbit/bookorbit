import { BadRequestException } from '@nestjs/common';

import { UploadValidatorService } from './upload-validator.service';

describe('UploadValidatorService', () => {
  let service: UploadValidatorService;

  beforeEach(() => {
    service = new UploadValidatorService();
  });

  describe('validateFormat', () => {
    it('accepts supported extensions case-insensitively from filename', () => {
      expect(service.validateFormat('Book.EPUB', [])).toBe('epub');
    });

    it('rejects unsupported formats', () => {
      expect(() => service.validateFormat('book.exe', [])).toThrow(BadRequestException);
    });

    it('matches library allowed formats even when config casing/whitespace differs', () => {
      expect(service.validateFormat('book.epub', [' EPUB ', 'PDF'])).toBe('epub');
    });

    it('rejects when extension is globally supported but blocked by library policy', () => {
      expect(() => service.validateFormat('book.cbz', ['epub', 'pdf'])).toThrow(new BadRequestException('This library does not allow .cbz files'));
    });
  });

  describe('sanitizeFilename', () => {
    it('replaces forbidden path and control characters', () => {
      expect(service.sanitizeFilename('a/b\\c:d*e?f"g<h>i|j\0.epub')).toBe('a_b_c_d_e_f_g_h_i_j_.epub');
    });

    it('falls back to upload when empty after trimming', () => {
      expect(service.sanitizeFilename('   ')).toBe('upload');
    });

    it('preserves extension when trimming overlong names', () => {
      const raw = `${'a'.repeat(400)}.epub`;
      const sanitized = service.sanitizeFilename(raw);
      expect(sanitized.endsWith('.epub')).toBe(true);
      expect(sanitized.length).toBeLessThanOrEqual(255);
    });

    it('adds upload stem when stem is empty but extension exists', () => {
      expect(service.sanitizeFilename('.epub')).toBe('upload.epub');
    });
  });
});
