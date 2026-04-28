import { BadRequestException } from '@nestjs/common';
import { FontValidationService } from './font.validation.service';

vi.mock('opentype.js', () => ({
  parse: vi.fn(),
}));

import { parse } from 'opentype.js';

const parseMock = vi.mocked(parse);

describe('FontValidationService', () => {
  let service: FontValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FontValidationService();
  });

  describe('validateFormat', () => {
    it('accepts valid TTF magic bytes (version 1.0)', () => {
      const buffer = Buffer.from([0x00, 0x01, 0x00, 0x00, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(buffer, 'ttf')).not.toThrow();
    });

    it('accepts valid TTF magic bytes ("true")', () => {
      const buffer = Buffer.from([0x74, 0x72, 0x75, 0x65, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(buffer, 'ttf')).not.toThrow();
    });

    it('accepts valid OTF magic bytes ("OTTO")', () => {
      const buffer = Buffer.from([0x4f, 0x54, 0x54, 0x4f, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(buffer, 'otf')).not.toThrow();
    });

    it('accepts valid WOFF magic bytes', () => {
      const buffer = Buffer.from([0x77, 0x4f, 0x46, 0x46, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(buffer, 'woff')).not.toThrow();
    });

    it('accepts valid WOFF2 magic bytes', () => {
      const buffer = Buffer.from([0x77, 0x4f, 0x46, 0x32, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(buffer, 'woff2')).not.toThrow();
    });

    it('rejects when magic bytes do not match declared format', () => {
      const ttfBuffer = Buffer.from([0x00, 0x01, 0x00, 0x00, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(ttfBuffer, 'otf')).toThrow(BadRequestException);
    });

    it('rejects unrecognized magic bytes', () => {
      const buffer = Buffer.from([0xff, 0xff, 0xff, 0xff, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(buffer, 'ttf')).toThrow(BadRequestException);
    });

    it('rejects files smaller than 4 bytes', () => {
      const buffer = Buffer.from([0x00, 0x01]);
      expect(() => service.validateFormat(buffer, 'ttf')).toThrow(BadRequestException);
    });

    it('rejects unsupported format', () => {
      const buffer = Buffer.from([0x00, 0x01, 0x00, 0x00, ...Array(100).fill(0)]);
      expect(() => service.validateFormat(buffer, 'svg' as never)).toThrow(BadRequestException);
    });
  });

  describe('extractMetadata', () => {
    it('extracts family name, weight, and style from font metadata', () => {
      parseMock.mockReturnValue({
        names: {
          fontFamily: { en: 'Literata' },
          fontSubfamily: { en: 'Bold Italic' },
        },
        tables: {
          os2: { usWeightClass: 700, fsSelection: 1 },
        },
      } as never);

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Literata-BoldItalic.ttf');
      expect(result.familyName).toBe('Literata');
      expect(result.weight).toBe(700);
      expect(result.style).toBe('italic');
    });

    it('normalizes weight to nearest hundred', () => {
      parseMock.mockReturnValue({
        names: { fontFamily: { en: 'Test' }, fontSubfamily: { en: 'Regular' } },
        tables: { os2: { usWeightClass: 350, fsSelection: 0 } },
      } as never);

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Test.ttf');
      expect(result.weight).toBe(400);
    });

    it('falls back to filename heuristics when parsing fails', () => {
      parseMock.mockImplementation(() => {
        throw new Error('Cannot parse WOFF2');
      });

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'MyFont-Bold-Italic.woff2');
      expect(result.familyName).toBe('MyFont');
      expect(result.weight).toBe(700);
      expect(result.style).toBe('italic');
    });

    it('detects weight from filename when metadata lacks weight', () => {
      parseMock.mockReturnValue({
        names: { fontFamily: { en: 'Test' }, fontSubfamily: { en: '' } },
        tables: { os2: {} },
      } as never);

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Test-Light.ttf');
      expect(result.weight).toBe(300);
    });

    it('detects italic from subfamily name', () => {
      parseMock.mockReturnValue({
        names: { fontFamily: { en: 'Test' }, fontSubfamily: { en: 'italic' } },
        tables: { os2: { usWeightClass: 400, fsSelection: 0 } },
      } as never);

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Test-Italic.ttf');
      expect(result.style).toBe('italic');
    });

    it('defaults to weight 400 and style normal when no metadata or heuristics match', () => {
      parseMock.mockReturnValue({
        names: { fontFamily: { en: 'Test' }, fontSubfamily: { en: '' } },
        tables: { os2: {} },
      } as never);

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Test.ttf');
      expect(result.weight).toBe(400);
      expect(result.style).toBe('normal');
    });

    it('returns null family name when metadata has no fontFamily', () => {
      parseMock.mockReturnValue({
        names: { fontFamily: {}, fontSubfamily: { en: '' } },
        tables: { os2: { usWeightClass: 400, fsSelection: 0 } },
      } as never);

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'TestFont.ttf');
      expect(result.familyName).toBeNull();
    });

    it('extracts family name from filename stripping weight/style keywords', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });

      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Open_Sans-SemiBold-Italic.ttf');
      expect(result.familyName).toBe('Open Sans');
      expect(result.weight).toBe(600);
      expect(result.style).toBe('italic');
    });

    it('detects thin weight', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Roboto-Thin.otf');
      expect(result.weight).toBe(100);
    });

    it('detects extralight weight', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Roboto-ExtraLight.otf');
      expect(result.weight).toBe(200);
    });

    it('detects medium weight', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Roboto-Medium.woff');
      expect(result.weight).toBe(500);
    });

    it('detects black weight', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Roboto-Black.woff2');
      expect(result.weight).toBe(900);
    });

    it('detects extrabold weight (not misclassified as bold)', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Roboto-ExtraBold.ttf');
      expect(result.weight).toBe(800);
    });

    it('detects extrabold with space separator (Extra-Bold after normalisation)', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Roboto-Extra-Bold.ttf');
      expect(result.weight).toBe(800);
    });

    it('detects ultrabold weight (not misclassified as bold)', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Font-UltraBold.ttf');
      expect(result.weight).toBe(800);
    });

    it('detects semibold weight', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Font-SemiBold.woff2');
      expect(result.weight).toBe(600);
    });

    it('does not false-positive on word containing a keyword as substring', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });
      // "Abnormal" contains "normal" but as a substring, not a word token
      const result = service.extractMetadata(Buffer.from([0, 1, 2, 3]), 'Abnormal.ttf');
      expect(result.weight).toBe(400); // default, not matched by "normal"
    });
  });
});
