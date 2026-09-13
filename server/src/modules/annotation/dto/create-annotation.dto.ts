import {
  ArrayNotEmpty,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ANNOTATION_STYLES } from '../annotation.constants';

export class CreateAnnotationRectDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  @IsPositive()
  width!: number;

  @IsNumber()
  @IsPositive()
  height!: number;
}

export class CreateAnnotationPdfDto {
  @IsInt()
  @Min(0)
  page!: number;

  @IsDefined()
  @ValidateNested()
  @Type(() => CreateAnnotationRectDto)
  rect!: CreateAnnotationRectDto;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateAnnotationRectDto)
  rects!: CreateAnnotationRectDto[];
}

@ValidatorConstraint({ name: 'exactlyOneAnnotationLocation', async: false })
class ExactlyOneLocationConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateAnnotationDto;
    const hasCfi = dto.cfi !== undefined && dto.cfi !== null;
    const hasPdf = dto.pdf !== undefined && dto.pdf !== null;
    return hasCfi !== hasPdf;
  }

  defaultMessage(): string {
    return 'Provide exactly one of cfi or pdf';
  }
}

@ValidatorConstraint({ name: 'pdfRequiresBookFile', async: false })
class PdfRequiresBookFileConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateAnnotationDto;
    return dto.pdf == null || dto.bookFileId != null;
  }

  defaultMessage(): string {
    return 'bookFileId is required for pdf annotations';
  }
}

export class CreateAnnotationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  cfi?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAnnotationPdfDto)
  pdf?: CreateAnnotationPdfDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookFileId?: number;

  // Anchored to an always-present property so the class-level check runs even
  // when cfi/pdf are absent (an @IsOptional property short-circuits its own validators).
  @Validate(ExactlyOneLocationConstraint)
  @Validate(PdfRequiresBookFileConstraint)
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
