import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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
      expect(() => service.validateFormat('book.cbz', ['epub', 'pdf'])).toThrow(BadRequestException);
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

  describe('validateContent', () => {
    it.each([
      ['epub', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
      ['kepub', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
      ['cbz', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
      ['pdf', Buffer.from('%PDF-1.7')],
      ['cbr', Buffer.from('Rar!\x1a\x07\x01')],
      ['cb7', Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
      [
        'mobi',
        (() => {
          const value = Buffer.alloc(80);
          value.write('BOOKMOBI', 60);
          return value;
        })(),
      ],
      [
        'azw3',
        (() => {
          const value = Buffer.alloc(80);
          value.write('BOOKMOBI', 60);
          return value;
        })(),
      ],
      ['fb2', Buffer.from('<?xml version="1.0"?><FictionBook xmlns="urn:fb2"></FictionBook>')],
      ['flac', Buffer.from('fLaC')],
      ['ogg', Buffer.from('OggS')],
      ['opus', Buffer.from('OggSOpusHead')],
      ['m4b', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4B ')])],
      ['m4a', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')])],
      ['mp3', Buffer.from('ID3\x04\x00')],
    ])('accepts a bounded magic signature for %s', async (format, contents) => {
      const directory = await mkdtemp(join(tmpdir(), 'bookorbit-signature-test-'));
      const path = join(directory, `book.${format}`);
      try {
        await writeFile(path, contents);
        await expect(service.validateContent(path, format)).resolves.toBeUndefined();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it('rejects an empty or spoofed file even when its extension is valid', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'bookorbit-signature-test-'));
      const path = join(directory, 'book.epub');
      try {
        await writeFile(path, 'not a zip archive');
        await expect(service.validateContent(path, 'epub')).rejects.toMatchObject({
          response: { errorCode: 'UPLOAD_CONTENT_INVALID' },
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
});
