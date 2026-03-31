import { AuthorAutoEnrichmentWriteMode } from '@projectx/types';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsEnum, ValidateNested } from 'class-validator';

export class AuthorEnrichmentConditionsDto {
  @IsBoolean()
  neverEnriched!: boolean;

  @IsBoolean()
  missingBio!: boolean;

  @IsBoolean()
  missingPhoto!: boolean;
}

export class AuthorAutoEnrichmentConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  triggerOnImport!: boolean;

  @IsEnum(AuthorAutoEnrichmentWriteMode)
  writeMode!: AuthorAutoEnrichmentWriteMode;

  @IsDefined()
  @ValidateNested()
  @Type(() => AuthorEnrichmentConditionsDto)
  conditions!: AuthorEnrichmentConditionsDto;
}
