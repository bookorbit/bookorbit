import { IsBoolean } from 'class-validator';

export class AuthorEnrichmentConditionsDto {
  @IsBoolean()
  neverEnriched!: boolean;

  @IsBoolean()
  missingBio!: boolean;

  @IsBoolean()
  missingPhoto!: boolean;
}
