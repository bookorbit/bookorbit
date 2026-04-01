import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { AuthorEnrichmentConditionsDto } from './author-enrichment-conditions.dto';

export class PreviewAuthorEnrichmentCountDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => AuthorEnrichmentConditionsDto)
  conditions!: AuthorEnrichmentConditionsDto;
}
