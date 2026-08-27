import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ANNOTATION_STYLES } from '../annotation.constants';

export class CreateAnnotationRectDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  width!: number;

  @IsNumber()
  height!: number;
}

export class CreateAnnotationPdfDto {
  @IsInt()
  @Min(0)
  page!: number;

  @ValidateNested()
  @Type(() => CreateAnnotationRectDto)
  rect!: CreateAnnotationRectDto;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateAnnotationRectDto)
  rects!: CreateAnnotationRectDto[];
}

export class CreateAnnotationDto {
  @ValidateIf((o: CreateAnnotationDto) => o.pdf === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  cfi?: string;

  @ValidateIf((o: CreateAnnotationDto) => o.cfi === undefined)
  @ValidateNested()
  @Type(() => CreateAnnotationPdfDto)
  pdf?: CreateAnnotationPdfDto;

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
