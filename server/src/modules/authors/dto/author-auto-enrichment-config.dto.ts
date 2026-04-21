import { AuthorAutoEnrichmentWriteMode } from '@bookorbit/types';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsEnum, ValidateNested } from 'class-validator';
import { AuthorEnrichmentConditionsDto } from './author-enrichment-conditions.dto';

export { AuthorEnrichmentConditionsDto };

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
