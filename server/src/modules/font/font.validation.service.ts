import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { FontFormat, FontNamedInstance, FontStyle } from '@bookorbit/types';
import { CSS_FONT_WEIGHT_MAX, CSS_FONT_WEIGHT_MIN, FONT_FORMATS, FONT_WEIGHTS, compareFontVariants, isCssFontWeight } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { parseFontMetadata, type FontVariationAxis, type FontVariationInstance } from './font-metadata.parser';

export interface FontMetadata {
  familyName: string | null;
  weight: number;
  style: FontStyle;
  weightMin: number | null;
  weightMax: number | null;
  instances: FontNamedInstance[] | null;
}

const WEIGHT_AXIS = 'wght';
const ITALIC_AXIS = 'ital';
const SLANT_AXIS = 'slnt';

// Halfway along a 0-1 axis is the conventional cut between upright and italic.
const ITALIC_AXIS_THRESHOLD = 0.5;

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
    const startedAt = Date.now();
    try {
      const metadata = parseFontMetadata(buffer);
      const subfamilyName = (metadata.subfamilyName ?? '').toLowerCase();

      const range = this.resolveWeightRange(metadata.axes);
      const weightAxis = metadata.axes.find((axis) => axis.tag === WEIGHT_AXIS);
      const weight =
        range && weightAxis
          ? this.clampWeightToRange(weightAxis.default, range)
          : this.resolveWeight(metadata.usWeightClass, subfamilyName, filename);
      const style = this.resolveStyle(metadata.fsSelection, subfamilyName, filename);

      return {
        familyName: metadata.familyName,
        weight,
        style,
        weightMin: range?.min ?? null,
        weightMax: range?.max ?? null,
        instances: range ? this.resolveInstances(metadata.instances, range, weight, style) : null,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.debug(
        `[font.extract_metadata] [fail] filename="${sanitizeLogValue(filename)}" durationMs=${Date.now() - startedAt} errorClass=${error.name} error="${sanitizeLogValue(error.message)}" - falling back to filename heuristics`,
      );
      return this.extractFromFilename(filename);
    }
  }

  private resolveWeight(os2Weight: number | undefined, subfamily: string, filename: string): number {
    if (isCssFontWeight(os2Weight)) return os2Weight;

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

  /**
   * Reads the `wght` axis bounds. A file whose axis collapses to a single value varies
   * along some other axis only, so it renders as a static weight and reports no range.
   */
  private resolveWeightRange(axes: FontVariationAxis[]): { min: number; max: number } | null {
    const axis = axes.find((candidate) => candidate.tag === WEIGHT_AXIS);
    if (!axis) return null;

    const min = this.clampAxisWeight(axis.min);
    const max = this.clampAxisWeight(axis.max);
    return max > min ? { min, max } : null;
  }

  private clampAxisWeight(value: number): number {
    if (!Number.isFinite(value)) return CSS_FONT_WEIGHT_MIN;
    return Math.min(CSS_FONT_WEIGHT_MAX, Math.max(CSS_FONT_WEIGHT_MIN, Math.round(value)));
  }

  private clampWeightToRange(value: number, range: { min: number; max: number }): number {
    return Math.min(range.max, Math.max(range.min, this.clampAxisWeight(value)));
  }

  /**
   * Turns the positions the designer named into the styles the reader offers.
   *
   * A variable font is required to name its instances but not all of them do, and an
   * unnamed one is still selectable: the reader labels it from its weight. When a font
   * names nothing usable at all, the standard weights inside the axis range stand in, so
   * the range is never advertised without a way to reach it.
   */
  private resolveInstances(
    instances: FontVariationInstance[],
    range: { min: number; max: number },
    defaultWeight: number,
    fileStyle: FontStyle,
  ): FontNamedInstance[] {
    const seen = new Set<string>();
    const resolved: FontNamedInstance[] = [];

    for (const instance of instances) {
      const coordinate = instance.coordinates[WEIGHT_AXIS];
      if (coordinate === undefined) continue;

      const weight = this.clampWeightToRange(coordinate, range);
      const style = this.instanceStyle(instance, fileStyle);

      const key = `${weight}:${style}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resolved.push({ name: instance.name, weight, style });
    }

    if (resolved.length === 0) {
      const weights: number[] = FONT_WEIGHTS.filter((weight) => weight >= range.min && weight <= range.max);
      if (!weights.includes(defaultWeight)) weights.push(defaultWeight);
      return weights
        .sort((a, b) => a - b)
        .map((weight) => ({
          name: null,
          weight,
          style: fileStyle,
        }));
    }

    return resolved.sort(compareFontVariants);
  }

  /**
   * An instance is italic when it sits on the italic side of an `ital` or `slnt` axis.
   * With neither axis present the file's own style applies, since an italic-only variable
   * font names its instances "Light", "Bold" and so on without repeating "Italic".
   */
  private instanceStyle(instance: FontVariationInstance, fileStyle: FontStyle): FontStyle {
    const italic = instance.coordinates[ITALIC_AXIS];
    if (italic !== undefined) return italic >= ITALIC_AXIS_THRESHOLD ? 'italic' : 'normal';

    const slant = instance.coordinates[SLANT_AXIS];
    if (slant !== undefined) return slant !== 0 ? 'italic' : 'normal';

    return fileStyle;
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
      // A filename cannot say what a variation axis spans, so the font reads as static.
      weightMin: null,
      weightMax: null,
      instances: null,
    };
  }

  private normalizeFilename(filename: string): string {
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  }
}
