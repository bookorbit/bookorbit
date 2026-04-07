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

    it.each(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'flac'])('accepts audio format .%s', (ext) => {
      expect(service.validateFormat(`audio.${ext}`, [])).toBe(ext);
    });

    it('rejects an audio format when blocked by library policy', () => {
      expect(() => service.validateFormat('book.m4b', ['epub', 'pdf'])).toThrow(BadRequestException);
    });

    it('accepts .azw format', () => {
      expect(service.validateFormat('book.azw', [])).toBe('azw');
    });

    it('accepts .kepub format', () => {
      expect(service.validateFormat('book.kepub', [])).toBe('kepub');
    });

    it('double extension uses last extension', () => {
      expect(service.validateFormat('book.epub.pdf', [])).toBe('pdf');
    });

    it('no extension is rejected', () => {
      expect(() => service.validateFormat('book', [])).toThrow(BadRequestException);
    });

    it('empty allowed list means global set is used', () => {
      expect(service.validateFormat('book.epub', [])).toBe('epub');
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

    it('preserves CJK and accented characters', () => {
      expect(service.sanitizeFilename('日本語の本.epub')).toBe('日本語の本.epub');
      expect(service.sanitizeFilename('café.pdf')).toBe('café.pdf');
    });

    it('replaces null bytes with underscores', () => {
      expect(service.sanitizeFilename('\0\0\0')).toBe('___');
    });

    it('handles filename of only dots', () => {
      const result = service.sanitizeFilename('...');
      expect(result.length).toBeLessThanOrEqual(255);
    });

    it('trims trailing spaces', () => {
      expect(service.sanitizeFilename('  book.epub  ')).toBe('book.epub');
    });

    it('handles dotfile-like names with real extension', () => {
      expect(service.sanitizeFilename('..hidden.epub')).toBe('..hidden.epub');
    });

    it('truncates stem to keep total under 255 with long extension', () => {
      const raw = `${'x'.repeat(300)}.epub`;
      const result = service.sanitizeFilename(raw);
      expect(result.length).toBeLessThanOrEqual(255);
      expect(result.endsWith('.epub')).toBe(true);
      expect(result.startsWith('x'.repeat(250))).toBe(true);
    });

    it('truncates to 255 when extension alone exceeds limit', () => {
      const raw = `a.${'z'.repeat(260)}`;
      const result = service.sanitizeFilename(raw);
      expect(result.length).toBe(255);
    });

    it('preserves original extension casing', () => {
      expect(service.sanitizeFilename('Book.EPUB')).toBe('Book.EPUB');
    });
  });
});
