import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class PageSessionDto {
  @IsInt()
  @Min(1)
  page!: number;

  @IsInt()
  @Min(0)
  start_time!: number;

  @IsInt()
  @Min(1)
  duration!: number;

  @IsInt()
  @Min(1)
  total_pages!: number;
}

export class BookStatsDto {
  @IsString()
  document!: string;

  @IsString()
  @IsOptional()
  md5?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  authors?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  pages?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  id_book?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  total_read_secs?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  total_read_mins?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  total_read_pages?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  highlights?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  notes?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  last_open?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PageSessionDto)
  @IsOptional()
  page_sessions?: PageSessionDto[];
}

export class SaveStatsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookStatsDto)
  books!: BookStatsDto[];

  @IsInt()
  @Min(0)
  @IsOptional()
  since?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  timestamp?: number;

  @IsString()
  @IsOptional()
  device?: string;

  @IsString()
  @IsOptional()
  device_id?: string;
}
