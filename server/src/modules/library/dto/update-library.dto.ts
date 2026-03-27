import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateLibraryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  folders?: string[];

  @IsOptional()
  @IsIn(['2/3', '1/1'])
  coverAspectRatio?: string;

  @IsOptional()
  @IsBoolean()
  watch?: boolean;

  @IsOptional()
  @IsString()
  @ValidateIf((o: { autoScanCronExpression?: unknown }) => o.autoScanCronExpression !== null)
  @Matches(/^((\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)? ){4}(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/, {
    message: 'autoScanCronExpression must be a valid 5-field cron expression',
  })
  autoScanCronExpression?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metadataPrecedence?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formatPriority?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedFormats?: string[];

  @IsOptional()
  @IsIn(['auto', 'book_per_file', 'book_per_folder'])
  organizationMode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludePatterns?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  markAsFinishedSecondsRemaining?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  markAsFinishedPercentComplete?: number | null;

  @IsOptional()
  @ValidateIf((o: { fileNamingPattern?: unknown }) => o.fileNamingPattern !== null)
  @IsString()
  @MaxLength(500)
  fileNamingPattern?: string | null;
}
