import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { ANNOTATION_STYLES } from '../annotation.constants';

export class UpdateAnnotationDto {
  @IsOptional()
  @ValidateIf((o: UpdateAnnotationDto) => o.note !== null)
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsIn(ANNOTATION_STYLES)
  style?: string;

  /** Server-only metadata: toggling it alone does not bump the version devices sync from. */
  @ValidateIf((o: UpdateAnnotationDto) => o.starred !== undefined)
  @IsBoolean()
  starred?: boolean;
}
