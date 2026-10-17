import { ConflictException } from '@nestjs/common';
import type { FontUploadErrorCode } from '@bookorbit/types';

/** Postgres unique violation, reported either directly or as the cause of a driver error. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const directCode = (error as { code?: unknown }).code;
  if (directCode === '23505') return true;

  if (!(error instanceof Error)) return false;
  const causeCode = (error.cause as { code?: unknown } | undefined)?.code;
  return causeCode === '23505';
}

/** A file would take a family/weight/style slot another file already holds. */
export function faceTaken(familyName: string, weight: number, style: string, message: string): ConflictException {
  return new ConflictException({
    message,
    errorCode: 'FONT_FACE_TAKEN' satisfies FontUploadErrorCode,
    errorMeta: { familyName, weight, style },
  });
}

/** The same bytes are already in the collection; names the face they became, so the client can say which. */
export function duplicateFont(existing: { familyName: string; weight: number; style: string }): ConflictException {
  return new ConflictException({
    message: 'This font file has already been uploaded',
    errorCode: 'FONT_DUPLICATE' satisfies FontUploadErrorCode,
    errorMeta: { familyName: existing.familyName, weight: existing.weight, style: existing.style },
  });
}

/** A whole-family rename that would merge two files into the same weight and style. */
export function familyFaceTaken(newFamilyName: string): ConflictException {
  return new ConflictException({
    message: `"${newFamilyName}" already has a file at the same weight and style`,
    errorCode: 'FONT_FACE_TAKEN' satisfies FontUploadErrorCode,
    errorMeta: { familyName: newFamilyName },
  });
}
