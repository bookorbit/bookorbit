import { REQUEST_LANGUAGE_CODES } from '@bookorbit/types';
import { IsIn, IsString, ValidateIf } from 'class-validator';

export class UpdateBookRequestLanguageDto {
  /**
   * A two-letter code, or null to accept any language.
   *
   * Restricted to codes the release matcher can compare, because the language is a hard filter: a
   * code it does not know rejects every release rather than leaving the request open.
   */
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsIn(REQUEST_LANGUAGE_CODES as string[])
  language!: string | null;
}
