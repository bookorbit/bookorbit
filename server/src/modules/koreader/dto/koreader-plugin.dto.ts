import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const MD5_HEX = /^[0-9a-f]{32}$/i;
const DEVICE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class PluginDeviceDto {
  @IsString()
  @Matches(/^[A-Za-z0-9-]{1,100}$/)
  deviceId!: string;

  @IsString()
  @MaxLength(100)
  deviceModel!: string;

  @IsString()
  @MaxLength(20)
  pluginVersion!: string;

  /**
   * Device-local wall clock at request time. KOReader datetimes carry no timezone,
   * so the server needs this to mint datetimes in the device's clock frame.
   */
  @IsOptional()
  @IsString()
  @Matches(DEVICE_DATETIME)
  deviceTime?: string;
}

export class MatchCheckDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(MD5_HEX, { each: true })
  hashes!: string[];
}

export class PageStatEventDto {
  @IsInt()
  @Min(0)
  page!: number;

  @IsInt()
  @Min(1)
  startTime!: number;

  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds!: number;

  @IsInt()
  @Min(1)
  totalPages!: number;
}

export class PageStatsBookDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PageStatEventDto)
  events!: PageStatEventDto[];
}

export class PageStatsUploadDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PageStatsBookDto)
  books!: PageStatsBookDto[];
}

export class KoreaderAnnotationDto {
  @IsString()
  @Matches(DEVICE_DATETIME)
  datetime!: string;

  @IsOptional()
  @IsString()
  @Matches(DEVICE_DATETIME)
  datetimeUpdated?: string;

  @IsIn(['lighten', 'underscore', 'strikeout', 'invert'])
  drawer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  chapter?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageno?: number;

  @IsIn(['xpointer', 'pdf'])
  posFormat!: string;

  @IsString()
  @MaxLength(4000)
  pos0!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pos1?: string;
}

export class AnnotationsBookDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => KoreaderAnnotationDto)
  annotations!: KoreaderAnnotationDto[];
}

export class AnnotationsUploadDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnnotationsBookDto)
  books!: AnnotationsBookDto[];
}

export class BookStateDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsOptional()
  @IsIn(['reading', 'complete', 'abandoned'])
  status?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY)
  statusModified?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}

export class BookStatesUploadDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BookStateDto)
  books!: BookStateDto[];
}

export class BulkProgressItemDto {
  @IsString()
  @Matches(MD5_HEX)
  hash!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  percentage!: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  progress?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  timestamp?: number;
}

export class BulkProgressDto extends PluginDeviceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkProgressItemDto)
  items!: BulkProgressItemDto[];
}

export class SweepCompleteDto extends PluginDeviceDto {
  @IsInt()
  @Min(0)
  booksMatched!: number;

  @IsInt()
  @Min(0)
  pageStatsUploaded!: number;

  @IsInt()
  @Min(0)
  annotationsUpserted!: number;
}
