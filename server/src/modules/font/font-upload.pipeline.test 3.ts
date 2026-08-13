import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { MAX_FONT_FILE_SIZE } from '@bookorbit/types';

import { inspectFontUpload, resolveFontFormat, resolveFontIdentity } from './font-upload.pipeline';
import type { FontValidationService } from './font.validation.service';

function makeValidation(overrides: Partial<Record<'validateFormat' | 'extractMetadata', ReturnType<typeof vi.fn>>> = {}) {
  return {
    validateFormat: vi.fn(),
    extractMetadata: vi.fn().mockReturnValue({ familyName: 'Literata', weight: 400, style: 'normal' }),
    ...overrides,
  };
}

function asValidation(mock: ReturnType<typeof makeValidation>): FontValidationService {
  return mock as unknown as FontValidationService;
}

const TTF_BUFFER = Buffer.from([0x00, 0x01, 0x00, 0x00, ...Array<number>(100).fill(0)]);

describe('resolveFontFormat', () => {
  it.each([
    ['Literata-Regular.ttf', 'ttf'],
    ['Literata.OTF', 'otf'],
    ['literata.woff', 'woff'],
    ['literata.WOFF2', 'woff2'],
  ])('maps %s to %s', (filename, expected) => {
    expect(resolveFontFormat(filename)).toBe(expected);
  });

  it('resolves from the final extension when the name contains dots', () => {
    expect(resolveFontFormat('My.Font.v2.woff2')).toBe('woff2');
  });

  it('rejects unsupported extensions', () => {
    expect(() => resolveFontFormat('font.svg')).toThrow(BadRequestException);
  });

  it('rejects a name with no extension', () => {
    expect(() => resolveFontFormat('Literata')).toThrow(BadRequestException);
  });
});

describe('inspectFontUpload', () => {
  it('returns the declared format and a sha256 of the file contents', () => {
    const validation = makeValidation();

    const result = inspectFontUpload(asValidation(validation), TTF_BUFFER, 'Literata-Regular.ttf');

    expect(result.format).toBe('ttf');
    expect(result.fileHash).toBe(createHash('sha256').update(TTF_BUFFER).digest('hex'));
    expect(validation.validateFormat).toHaveBeenCalledWith(TTF_BUFFER, 'ttf');
  });

  it('produces the same hash for identical bytes uploaded under different names', () => {
    const validation = makeValidation();

    const first = inspectFontUpload(asValidation(validation), TTF_BUFFER, 'Literata-Regular.ttf');
    const second = inspectFontUpload(asValidation(validation), Buffer.from(TTF_BUFFER), 'Copy.ttf');

    expect(second.fileHash).toBe(first.fileHash);
  });

  it('rejects files over the size limit', () => {
    const validation = makeValidation();
    const buffer = Buffer.alloc(0);
    Object.defineProperty(buffer, 'length', { value: MAX_FONT_FILE_SIZE + 1 });

    expect(() => inspectFontUpload(asValidation(validation), buffer, 'big.ttf')).toThrow(BadRequestException);
  });

  it('accepts a file at exactly the size limit', () => {
    const validation = makeValidation();
    const buffer = Buffer.from(TTF_BUFFER);
    Object.defineProperty(buffer, 'length', { value: MAX_FONT_FILE_SIZE });

    expect(() => inspectFontUpload(asValidation(validation), buffer, 'exact.ttf')).not.toThrow();
  });

  it('checks size before doing any format work', () => {
    const validation = makeValidation();
    const buffer = Buffer.alloc(0);
    Object.defineProperty(buffer, 'length', { value: MAX_FONT_FILE_SIZE + 1 });

    expect(() => inspectFontUpload(asValidation(validation), buffer, 'big.ttf')).toThrow(BadRequestException);
    expect(validation.validateFormat).not.toHaveBeenCalled();
  });

  it('propagates magic-byte rejections from the validation service', () => {
    const validation = makeValidation({
      validateFormat: vi.fn(() => {
        throw new BadRequestException('File does not appear to be a valid font (unrecognized magic bytes)');
      }),
    });

    expect(() => inspectFontUpload(asValidation(validation), TTF_BUFFER, 'fake.ttf')).toThrow(BadRequestException);
  });

  it('does not parse font metadata, leaving that until after dedupe', () => {
    const validation = makeValidation();

    inspectFontUpload(asValidation(validation), TTF_BUFFER, 'Literata-Regular.ttf');

    expect(validation.extractMetadata).not.toHaveBeenCalled();
  });
});

describe('resolveFontIdentity', () => {
  it('uses the family name embedded in the font', () => {
    const validation = makeValidation();

    const result = resolveFontIdentity(asValidation(validation), TTF_BUFFER, 'whatever.ttf');

    expect(result).toEqual({ familyName: 'Literata', weight: 400, style: 'normal', suggestedFamilyName: 'Literata' });
  });

  it('falls back to the filename when the font carries no family name', () => {
    const validation = makeValidation({
      extractMetadata: vi.fn().mockReturnValue({ familyName: null, weight: 700, style: 'italic' }),
    });

    const result = resolveFontIdentity(asValidation(validation), TTF_BUFFER, 'Literata-Bold-Italic.ttf');

    expect(result.familyName).toBe('Literata');
    expect(result.weight).toBe(700);
    expect(result.style).toBe('italic');
  });

  it('falls back to a generic label when the filename is only style words', () => {
    const validation = makeValidation({
      extractMetadata: vi.fn().mockReturnValue({ familyName: null, weight: 400, style: 'normal' }),
    });

    const result = resolveFontIdentity(asValidation(validation), TTF_BUFFER, 'Regular.ttf');

    expect(result.familyName).toBe('Custom Font');
  });

  it('reports suggestedFamilyName as null whenever the name had to be inferred', () => {
    const validation = makeValidation({
      extractMetadata: vi.fn().mockReturnValue({ familyName: null, weight: 400, style: 'normal' }),
    });

    const result = resolveFontIdentity(asValidation(validation), TTF_BUFFER, 'Literata.ttf');

    expect(result.familyName).toBe('Literata');
    expect(result.suggestedFamilyName).toBeNull();
  });
});
