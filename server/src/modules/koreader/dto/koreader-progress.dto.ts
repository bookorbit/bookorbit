import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class KoreaderSaveProgressDto {
  @IsString()
  document!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  percentage!: number;

  // KOReader sends an xpointer string for reflowable documents but a plain
  // page number for paged ones (PDF/CBZ/DjVu), so numbers are normalized here.
  @Transform(({ value }) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : value))
  @IsString()
  @IsOptional()
  progress?: string;

  @IsString()
  @IsOptional()
  device?: string;

  @IsString()
  @IsOptional()
  device_id?: string;

  @IsNumber()
  @IsOptional()
  timestamp?: number;
}
