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

export class CreateAnnotationPageDto {
  @IsInt()
  @Min(0)
  page!: number;
}

@ValidatorConstraint({ name: 'exactlyOneAnnotationLocation', async: false })
class ExactlyOneLocationConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateAnnotationDto;
    return [dto.cfi, dto.pdf, dto.page].filter((location) => location !== undefined && location !== null).length === 1;
  }

  defaultMessage(): string {
    return 'Provide exactly one of cfi, pdf or page';
  }
}

@ValidatorConstraint({ name: 'pdfRequiresBookFile', async: false })
class PdfRequiresBookFileConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateAnnotationDto;
    return (dto.pdf == null && dto.page == null) || dto.bookFileId != null;
  }

  defaultMessage(): string {
    return 'bookFileId is required for pdf and page annotations';
  }
}

// A PDF that denies text extraction still allows highlighting, so its highlights can have no text,
// and a comic page has no text to quote at all.
@ValidatorConstraint({ name: 'textRequiredForCfi', async: false })
class TextRequiredForCfiConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateAnnotationDto;
    if (dto.pdf != null || dto.page != null) return true;
    return typeof value === 'string' && value !== '';
  }

  defaultMessage(): string {
    return 'text should not be empty';
  }
}

// A page note has nothing but its note, so an empty one would be a blank row.
@ValidatorConstraint({ name: 'noteRequiredForPage', async: false })
class NoteRequiredForPageConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateAnnotationDto;
    return dto.page == null || (typeof dto.note === 'string' && dto.note.trim() !== '');
  }

  defaultMessage(): string {
    return 'note is required for page annotations';
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
  @ValidateNested()
  @Type(() => CreateAnnotationPageDto)
  page?: CreateAnnotationPageDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookFileId?: number;

  // Anchored to an always-present property so the class-level check runs even
  // when cfi/pdf are absent (an @IsOptional property short-circuits its own validators).
  @Validate(ExactlyOneLocationConstraint)
  @Validate(PdfRequiresBookFileConstraint)
  @Validate(TextRequiredForCfiConstraint)
  @Validate(NoteRequiredForPageConstraint)
  @IsString()
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
