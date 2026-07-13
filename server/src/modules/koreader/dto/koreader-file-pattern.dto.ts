import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

class KoreaderGroupingPatternsDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  seriesPattern = '';

  @IsOptional()
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
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  pattern = '';
}
