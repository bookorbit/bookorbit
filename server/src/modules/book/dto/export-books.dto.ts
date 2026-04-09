import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional } from 'class-validator';

export class ExportBooksDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  bookIds: number[];

  @IsOptional()
  @IsBoolean()
  allFormats?: boolean;

  @IsOptional()
  @IsBoolean()
  audioOnly?: boolean;
}
