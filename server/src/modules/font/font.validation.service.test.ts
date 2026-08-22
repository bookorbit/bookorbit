import { BadRequestException } from '@nestjs/common';

import { FontValidationService } from './font.validation.service';
import { buildFontWithMetadata, buildFvarTable, buildNameTable, buildOs2Table, buildSfnt, windowsName } from './font-test-fixtures';

vi.mock('./font-metadata.parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./font-metadata.parser')>();
  return { ...actual, parseFontMetadata: vi.fn(actual.parseFontMetadata) };
});

import { parseFontMetadata } from './font-metadata.parser';

const parseMock = vi.mocked(parseFontMetadata);

/** Any buffer works when the parser is stubbed; only the stubbed return value matters. */
const STUB_BUFFER = Buffer.from([0, 1, 2, 3]);

describe('FontValidationService', () => {
  let service: FontValidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    parseMock.mockRestore?.();
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
        familyName: 'Literata',
        subfamilyName: 'Bold Italic',
        usWeightClass: 700,
        fsSelection: 1,
        axes: [],
        instances: [],
      });

      const result = service.extractMetadata(STUB_BUFFER, 'Literata-BoldItalic.ttf');
      expect(result.familyName).toBe('Literata');
      expect(result.weight).toBe(700);
      expect(result.style).toBe('italic');
    });

    it('preserves a valid nonstandard CSS weight', () => {
      parseMock.mockReturnValue({ familyName: 'Test', subfamilyName: 'Regular', usWeightClass: 350, fsSelection: 0, axes: [], instances: [] });

      expect(service.extractMetadata(STUB_BUFFER, 'Test.ttf').weight).toBe(350);
    });

    it('falls back to filename heuristics when parsing fails', () => {
      parseMock.mockImplementation(() => {
        throw new Error('WOFF2 metadata extraction is not supported');
      });

      const result = service.extractMetadata(STUB_BUFFER, 'MyFont-Bold-Italic.woff2');
      expect(result.familyName).toBe('MyFont');
      expect(result.weight).toBe(700);
      expect(result.style).toBe('italic');
    });

    it('detects weight from filename when metadata lacks weight', () => {
      parseMock.mockReturnValue({
        familyName: 'Test',
        subfamilyName: null,
        usWeightClass: undefined,
        fsSelection: undefined,
        axes: [],
        instances: [],
      });

      expect(service.extractMetadata(STUB_BUFFER, 'Test-Light.ttf').weight).toBe(300);
    });

    it('detects italic from subfamily name', () => {
      parseMock.mockReturnValue({ familyName: 'Test', subfamilyName: 'Italic', usWeightClass: 400, fsSelection: 0, axes: [], instances: [] });

      expect(service.extractMetadata(STUB_BUFFER, 'Test-Italic.ttf').style).toBe('italic');
    });

    it('defaults to weight 400 and style normal when no metadata or heuristics match', () => {
      parseMock.mockReturnValue({
        familyName: 'Test',
        subfamilyName: null,
        usWeightClass: undefined,
        fsSelection: undefined,
        axes: [],
        instances: [],
      });

      const result = service.extractMetadata(STUB_BUFFER, 'Test.ttf');
      expect(result.weight).toBe(400);
      expect(result.style).toBe('normal');
    });

    it('returns null family name when the font carries no usable name', () => {
      parseMock.mockReturnValue({ familyName: null, subfamilyName: null, usWeightClass: 400, fsSelection: 0, axes: [], instances: [] });

      expect(service.extractMetadata(STUB_BUFFER, 'TestFont.ttf').familyName).toBeNull();
    });

    it('ignores an out-of-range usWeightClass and falls back to the filename', () => {
      parseMock.mockReturnValue({ familyName: 'Test', subfamilyName: null, usWeightClass: 5000, fsSelection: 0, axes: [], instances: [] });

      expect(service.extractMetadata(STUB_BUFFER, 'Test-Bold.ttf').weight).toBe(700);
    });

    it('extracts family name from filename stripping weight/style keywords', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });

      const result = service.extractMetadata(STUB_BUFFER, 'Open_Sans-SemiBold-Italic.ttf');
      expect(result.familyName).toBe('Open Sans');
      expect(result.weight).toBe(600);
      expect(result.style).toBe('italic');
    });

    it.each([
      ['Roboto-Thin.otf', 100],
      ['Roboto-ExtraLight.otf', 200],
      ['Roboto-Medium.woff', 500],
      ['Font-SemiBold.woff2', 600],
      ['Roboto-ExtraBold.ttf', 800],
      ['Roboto-Extra-Bold.ttf', 800],
      ['Font-UltraBold.ttf', 800],
      ['Roboto-Black.woff2', 900],
    ])('derives weight from the filename %s', (filename, expected) => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });

      expect(service.extractMetadata(STUB_BUFFER, filename).weight).toBe(expected);
    });

    it('does not false-positive on word containing a keyword as substring', () => {
      parseMock.mockImplementation(() => {
        throw new Error('fail');
      });

      // "Abnormal" contains "normal" but as a substring, not a word token
      expect(service.extractMetadata(STUB_BUFFER, 'Abnormal.ttf').weight).toBe(400);
    });
  });

  // The mocked cases above cannot catch a service that reads the wrong fields off the
  // parser, so these drive the real parser with real font bytes.
  describe('extractMetadata against real font binaries', () => {
    it('reads family, weight and style out of an actual font', () => {
      const font = buildFontWithMetadata({ family: 'Iosevka', subfamily: 'Bold', usWeightClass: 700, fsSelection: 32 });

      const result = service.extractMetadata(font, 'whatever-the-file-was-called.ttf');
      expect(result).toEqual({ familyName: 'Iosevka', weight: 700, style: 'normal', weightMin: null, weightMax: null, instances: null });
    });

    it('reads the italic bit out of fsSelection', () => {
      const font = buildFontWithMetadata({ family: 'Iosevka', subfamily: 'Italic', usWeightClass: 400, fsSelection: 1 });

      expect(service.extractMetadata(font, 'Iosevka.ttf').style).toBe('italic');
    });

    it('prefers the embedded typographic family over the filename', () => {
      const font = buildFontWithMetadata({
        family: 'Source Han Sans Light',
        subfamily: 'Regular',
        typographicFamily: 'Source Han Sans',
        typographicSubfamily: 'Light',
        usWeightClass: 300,
      });

      const result = service.extractMetadata(font, 'SourceHanSans-Light.ttf');
      expect(result.familyName).toBe('Source Han Sans');
      expect(result.weight).toBe(300);
    });

    it('falls back to filename heuristics for a real WOFF2 file', () => {
      const woff2 = Buffer.concat([Buffer.from('wOF2', 'latin1'), Buffer.alloc(200)]);

      const result = service.extractMetadata(woff2, 'Noto_Sans-Bold-Italic.woff2');
      expect(result.familyName).toBe('Noto Sans');
      expect(result.weight).toBe(700);
      expect(result.style).toBe('italic');
    });

    it('falls back to filename heuristics for truncated font bytes', () => {
      const result = service.extractMetadata(Buffer.from([0x00, 0x01, 0x00, 0x00]), 'Broken-Thin.ttf');
      expect(result.familyName).toBe('Broken');
      expect(result.weight).toBe(100);
    });
  });

  describe('extractMetadata for variable fonts', () => {
    const variableFont = (
      axes: { tag: string; min: number; default: number; max: number }[],
      instances: { subfamilyNameID: number; coordinates: number[] }[] = [],
      names = [windowsName(1, 'Inter'), windowsName(256, 'Light'), windowsName(257, 'Bold')],
      os2: { usWeightClass?: number; fsSelection?: number } = { usWeightClass: 400 },
    ) =>
      buildSfnt([
        { tag: 'name', data: buildNameTable(names) },
        { tag: 'OS/2', data: buildOs2Table(os2) },
        { tag: 'fvar', data: buildFvarTable(axes, instances) },
      ]);

    it("reports the weight axis as the file's range", () => {
      const font = variableFont([{ tag: 'wght', min: 100, default: 400, max: 900 }]);

      expect(service.extractMetadata(font, 'Inter.ttf')).toMatchObject({ weight: 400, weightMin: 100, weightMax: 900 });
    });

    it('uses the weight axis default even when it is not a standard hundred', () => {
      const font = variableFont([{ tag: 'wght', min: 300, default: 350, max: 1000 }]);

      expect(service.extractMetadata(font, 'Inter.ttf')).toMatchObject({ weight: 350, weightMin: 300, weightMax: 1000 });
    });

    it('offers the named instances as selectable styles', () => {
      const font = variableFont(
        [{ tag: 'wght', min: 100, default: 400, max: 900 }],
        [
          { subfamilyNameID: 257, coordinates: [700] },
          { subfamilyNameID: 256, coordinates: [300] },
        ],
      );

      expect(service.extractMetadata(font, 'Inter.ttf').instances).toEqual([
        { name: 'Light', weight: 300, style: 'normal' },
        { name: 'Bold', weight: 700, style: 'normal' },
      ]);
    });

    it('reads italic instances off the ital axis', () => {
      const font = variableFont(
        [
          { tag: 'wght', min: 100, default: 400, max: 900 },
          { tag: 'ital', min: 0, default: 0, max: 1 },
        ],
        [
          { subfamilyNameID: 256, coordinates: [300, 0] },
          { subfamilyNameID: 257, coordinates: [700, 1] },
        ],
      );

      expect(service.extractMetadata(font, 'Inter.ttf').instances).toEqual([
        { name: 'Light', weight: 300, style: 'normal' },
        { name: 'Bold', weight: 700, style: 'italic' },
      ]);
    });

    it('treats a slanted instance as italic', () => {
      const font = variableFont(
        [
          { tag: 'wght', min: 100, default: 400, max: 900 },
          { tag: 'slnt', min: -10, default: 0, max: 0 },
        ],
        [{ subfamilyNameID: 257, coordinates: [700, -10] }],
      );

      expect(service.extractMetadata(font, 'Inter.ttf').instances).toEqual([{ name: 'Bold', weight: 700, style: 'italic' }]);
    });

    it("keeps the file's own style for instances that name no italic axis", () => {
      const font = variableFont(
        [{ tag: 'wght', min: 100, default: 400, max: 900 }],
        [{ subfamilyNameID: 256, coordinates: [300] }],
        [windowsName(1, 'Inter'), windowsName(256, 'Light')],
        { usWeightClass: 400, fsSelection: 1 },
      );

      expect(service.extractMetadata(font, 'Inter-Italic.ttf').instances).toEqual([{ name: 'Light', weight: 300, style: 'italic' }]);
    });

    it('stands in the standard weights when the font names no usable instance', () => {
      const font = variableFont([{ tag: 'wght', min: 300, default: 400, max: 500 }]);

      expect(service.extractMetadata(font, 'Inter.ttf').instances).toEqual([
        { name: null, weight: 300, style: 'normal' },
        { name: null, weight: 400, style: 'normal' },
        { name: null, weight: 500, style: 'normal' },
      ]);
    });

    it('keeps a narrow axis reachable when it contains no standard weight', () => {
      const font = variableFont([{ tag: 'wght', min: 20, default: 35, max: 50 }]);

      expect(service.extractMetadata(font, 'Inter.ttf').instances).toEqual([{ name: null, weight: 35, style: 'normal' }]);
    });

    it('reports no range for a font whose only axis is not weight', () => {
      const font = variableFont([{ tag: 'wdth', min: 75, default: 100, max: 125 }]);

      expect(service.extractMetadata(font, 'Inter.ttf')).toMatchObject({ weightMin: null, weightMax: null, instances: null });
    });

    it('reports no range for a weight axis that spans a single value', () => {
      const font = variableFont([{ tag: 'wght', min: 400, default: 400, max: 400 }]);

      expect(service.extractMetadata(font, 'Inter.ttf')).toMatchObject({ weightMin: null, weightMax: null, instances: null });
    });

    it('clamps an axis declaring weights outside what CSS accepts', () => {
      const font = variableFont([{ tag: 'wght', min: -50, default: 400, max: 4000 }]);

      expect(service.extractMetadata(font, 'Inter.ttf')).toMatchObject({ weightMin: 1, weightMax: 1000 });
    });

    it('drops a duplicate instance rather than offering the same style twice', () => {
      const font = variableFont(
        [{ tag: 'wght', min: 100, default: 400, max: 900 }],
        [
          { subfamilyNameID: 256, coordinates: [300] },
          { subfamilyNameID: 257, coordinates: [300] },
        ],
      );

      expect(service.extractMetadata(font, 'Inter.ttf').instances).toEqual([{ name: 'Light', weight: 300, style: 'normal' }]);
    });
  });
});
