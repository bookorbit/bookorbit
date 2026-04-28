import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { FONT_WEIGHTS, type FontStyle } from '@bookorbit/types';

export class UpdateFontDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  familyName?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(900)
  @IsIn([...FONT_WEIGHTS])
  weight?: number;

  @IsOptional()
  @IsString()
  @IsIn(['normal', 'italic'])
  style?: FontStyle;
}
