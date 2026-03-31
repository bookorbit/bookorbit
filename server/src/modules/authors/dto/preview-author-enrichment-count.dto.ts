import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, ValidateNested } from 'class-validator';

export class PreviewAuthorEnrichmentConditionsDto {
  @IsBoolean()
  neverEnriched!: boolean;

  @IsBoolean()
  missingBio!: boolean;

  @IsBoolean()
  missingPhoto!: boolean;
}

export class PreviewAuthorEnrichmentCountDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => PreviewAuthorEnrichmentConditionsDto)
  conditions!: PreviewAuthorEnrichmentConditionsDto;
}
