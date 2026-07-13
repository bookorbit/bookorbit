import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

class KoreaderGroupingPatternsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  seriesPattern = '';

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  standalonePattern = '';
}

export class UpdateKoreaderFilePatternDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  pattern!: string;
}

export class UpdateKoreaderDeviceFilePatternDto extends KoreaderGroupingPatternsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  pattern = '';
}
