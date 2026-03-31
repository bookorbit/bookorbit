import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';

class FormatWriteSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxFileSizeBytes?: number;
}

class CbxFormatWriteSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxFileSizeBytes?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(['cbz', 'cb7'], { each: true })
  formats?: ('cbz' | 'cb7')[];
}

export class UpdateFileWriteSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  writeCover?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => FormatWriteSettingsDto)
  epub?: FormatWriteSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FormatWriteSettingsDto)
  pdf?: FormatWriteSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CbxFormatWriteSettingsDto)
  cbx?: CbxFormatWriteSettingsDto;
}
