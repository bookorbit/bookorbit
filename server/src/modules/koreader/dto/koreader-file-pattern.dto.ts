import { IsString, MaxLength, MinLength, ValidateBy, ValidateIf } from 'class-validator';

import { validatePattern } from '@bookorbit/types';

const IsFileNamingPattern = () =>
  ValidateBy({
    name: 'isFileNamingPattern',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && validatePattern(value),
      defaultMessage: () => 'Pattern contains invalid characters',
    },
  });

class KoreaderGroupingPatternsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  @IsFileNamingPattern()
  seriesPattern = '';

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  @IsFileNamingPattern()
  standalonePattern = '';
}

export class UpdateKoreaderFilePatternDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  @IsFileNamingPattern()
  pattern!: string;
}

export class UpdateKoreaderDeviceFilePatternDto extends KoreaderGroupingPatternsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  @IsFileNamingPattern()
  pattern = '';
}
