import { IsString, MaxLength, MinLength } from 'class-validator';
import { FONT_FAMILY_NAME_MAX_LENGTH, type RenameFontFamilyRequest } from '@bookorbit/types';

export class RenameFontFamilyDto implements RenameFontFamilyRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(FONT_FAMILY_NAME_MAX_LENGTH)
  familyName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(FONT_FAMILY_NAME_MAX_LENGTH)
  newFamilyName!: string;
}
