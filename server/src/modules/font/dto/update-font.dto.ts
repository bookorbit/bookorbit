import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CSS_FONT_WEIGHT_MAX, CSS_FONT_WEIGHT_MIN, type FontStyle } from '@bookorbit/types';

export class UpdateFontDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  familyName?: string;

  @IsOptional()
  @IsInt()
  @Min(CSS_FONT_WEIGHT_MIN)
  @Max(CSS_FONT_WEIGHT_MAX)
  weight?: number;

  @IsOptional()
  @IsString()
  @IsIn(['normal', 'italic'])
  style?: FontStyle;
}
