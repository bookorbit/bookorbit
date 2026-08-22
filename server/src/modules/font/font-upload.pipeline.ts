import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FONT_FORMATS, MAX_FONT_FILE_SIZE, type FontFormat, type FontNamedInstance, type FontStyle } from '@bookorbit/types';

import { familyNameFromFilename, type FontValidationService } from './font.validation.service';

const FALLBACK_FAMILY_NAME = 'Custom Font';

export interface InspectedFontUpload {
  format: FontFormat;
  fileHash: string;
}

export interface FontIdentity {
  familyName: string;
  weight: number;
  style: FontStyle;
  weightMin: number | null;
  weightMax: number | null;
  instances: FontNamedInstance[] | null;
  /** Family name read from the font's own tables, or null when it had to be inferred. */
  suggestedFamilyName: string | null;
}

export function resolveFontFormat(filename: string): FontFormat {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && (FONT_FORMATS as readonly string[]).includes(ext)) {
    return ext as FontFormat;
  }
  throw new BadRequestException(`Unsupported file extension. Supported formats: ${FONT_FORMATS.join(', ')}`);
}

/**
 * Runs the cheap, order-sensitive part of an upload: size limit, declared format,
 * magic bytes, and content hash. Callers dedupe on the returned hash before paying
 * for metadata parsing.
 */
export function inspectFontUpload(validation: FontValidationService, buffer: Buffer, filename: string): InspectedFontUpload {
  if (buffer.length > MAX_FONT_FILE_SIZE) {
    throw new BadRequestException(`Font file exceeds maximum size of ${MAX_FONT_FILE_SIZE / 1024 / 1024} MB`);
  }

  const format = resolveFontFormat(filename);
  validation.validateFormat(buffer, format);

  return { format, fileHash: createHash('sha256').update(buffer).digest('hex') };
}

/**
 * Parses the font's own naming tables, falling back to the filename and finally to a
 * generic label so a font always lands under some family.
 */
export function resolveFontIdentity(validation: FontValidationService, buffer: Buffer, filename: string): FontIdentity {
  const metadata = validation.extractMetadata(buffer, filename);
  return {
    familyName: metadata.familyName ?? familyNameFromFilename(filename) ?? FALLBACK_FAMILY_NAME,
    weight: metadata.weight,
    style: metadata.style,
    weightMin: metadata.weightMin,
    weightMax: metadata.weightMax,
    instances: metadata.instances,
    suggestedFamilyName: metadata.familyName,
  };
}
