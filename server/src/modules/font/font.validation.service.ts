import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { parse } from 'opentype.js';
import type { FontFormat, FontStyle } from '@bookorbit/types';
import { FONT_FORMATS } from '@bookorbit/types';

export interface FontMetadata {
  familyName: string | null;
  weight: number;
  style: FontStyle;
}

const MAGIC_BYTES: Record<string, FontFormat[]> = {
  // TTF: version 1.0
  '00010000': ['ttf'],
  // TTF: "true" (Apple TrueType)
  '74727565': ['ttf'],
  // OTF: "OTTO"
  '4f54544f': ['otf'],
  // WOFF1: "wOFF"
  '774f4646': ['woff'],
  // WOFF2: "wOF2"
  '774f4632': ['woff2'],
};

// More-specific patterns must precede narrower ones (e.g. extra-bold before bold).
// \s* handles both "ExtraBold" and "Extra Bold" (after filename normalisation).
const WEIGHT_PATTERNS: [RegExp, number][] = [
  [/\bthin\b/, 100],
  [/\bhairline\b/, 100],
  [/\bextra\s*light\b/, 200],
  [/\bultra\s*light\b/, 200],
  [/\blight\b/, 300],
  [/\bregular\b/, 400],
  [/\bnormal\b/, 400],
  [/\bmedium\b/, 500],
  [/\bdemi\s*bold\b/, 600],
  [/\bsemi\s*bold\b/, 600],
  [/\bextra\s*bold\b/, 800],
  [/\bultra\s*bold\b/, 800],
  [/\bbold\b/, 700],
  [/\bblack\b/, 900],
  [/\bheavy\b/, 900],
];

const FAMILY_NAME_STRIP =
  /\b(?:extra\s*light|ultra\s*light|extra\s*bold|ultra\s*bold|semi\s*bold|demi\s*bold|thin|hairline|light|regular|normal|medium|bold|black|heavy|italic|oblique)\b/gi;

export function familyNameFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[-_]/g, ' ').replace(FAMILY_NAME_STRIP, '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

@Injectable()
export class FontValidationService {
  private readonly logger = new Logger(FontValidationService.name);

  validateFormat(buffer: Buffer, declaredFormat: FontFormat): void {
    if (!FONT_FORMATS.includes(declaredFormat)) {
      throw new BadRequestException(`Unsupported font format: ${declaredFormat}`);
    }

    if (buffer.length < 4) {
      throw new BadRequestException('File too small to be a valid font');
    }

    const magic = buffer.subarray(0, 4).toString('hex');
    const allowedFormats = MAGIC_BYTES[magic];

    if (!allowedFormats) {
      throw new BadRequestException('File does not appear to be a valid font (unrecognized magic bytes)');
    }

    if (!allowedFormats.includes(declaredFormat)) {
      throw new BadRequestException(`File content does not match declared format "${declaredFormat}"`);
    }
  }

  extractMetadata(buffer: Buffer, filename: string): FontMetadata {
    try {
      const font = parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      const familyName = (font.names?.fontFamily as Record<string, string>)?.en ?? null;
      const subfamilyName = ((font.names?.fontSubfamily as Record<string, string>)?.en ?? '').toLowerCase();

      const weight = this.resolveWeight(font.tables?.os2?.usWeightClass, subfamilyName, filename);
      const style = this.resolveStyle(font.tables?.os2?.fsSelection, subfamilyName, filename);

      return { familyName, weight, style };
    } catch (err) {
      this.logger.debug(
        `[font.extract_metadata] [fail] filename=${filename} error="${(err as Error).message}" - falling back to filename heuristics`,
      );
      return this.extractFromFilename(filename);
    }
  }

  private resolveWeight(os2Weight: number | undefined, subfamily: string, filename: string): number {
    if (os2Weight && os2Weight >= 100 && os2Weight <= 900) {
      return Math.round(os2Weight / 100) * 100;
    }

    return this.weightFromString(subfamily) ?? this.weightFromString(this.normalizeFilename(filename)) ?? 400;
  }

  private resolveStyle(fsSelection: number | undefined, subfamily: string, filename: string): FontStyle {
    if (fsSelection !== undefined && (fsSelection & 1) !== 0) {
      return 'italic';
    }

    const combined = `${subfamily} ${this.normalizeFilename(filename)}`.toLowerCase();
    if (/\bitalic\b/.test(combined) || /\boblique\b/.test(combined)) {
      return 'italic';
    }

    return 'normal';
  }

  private weightFromString(str: string): number | null {
    const lower = str.toLowerCase();
    for (const [pattern, weight] of WEIGHT_PATTERNS) {
      if (pattern.test(lower)) return weight;
    }
    return null;
  }

  private extractFromFilename(filename: string): FontMetadata {
    const normalized = this.normalizeFilename(filename);
    return {
      familyName: familyNameFromFilename(filename),
      weight: this.weightFromString(normalized) ?? 400,
      style: /\bitalic\b/i.test(normalized) || /\boblique\b/i.test(normalized) ? 'italic' : 'normal',
    };
  }

  private familyNameFromFilename(filename: string): string | null {
    return familyNameFromFilename(filename);
  }

  private normalizeFilename(filename: string): string {
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  }
}
