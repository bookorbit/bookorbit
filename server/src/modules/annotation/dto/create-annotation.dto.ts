import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { ANNOTATION_STYLES } from '../annotation.constants';

export class CreateAnnotationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  cfi!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookFileId?: number;

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsIn(ANNOTATION_STYLES)
  style?: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  chapterTitle?: string | null;
}
