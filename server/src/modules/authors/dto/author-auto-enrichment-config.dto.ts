import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, ValidateNested } from 'class-validator';
import { AuthorEnrichmentConditionsDto } from './author-enrichment-conditions.dto';

export { AuthorEnrichmentConditionsDto };

export class AuthorAutoEnrichmentConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  triggerOnImport!: boolean;

  @IsDefined()
  @ValidateNested()
  @Type(() => AuthorEnrichmentConditionsDto)
  conditions!: AuthorEnrichmentConditionsDto;
}
