import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAnnotationDto {
  @IsString()
  @IsNotEmpty()
  cfi!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  style?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  chapterTitle?: string;
}
