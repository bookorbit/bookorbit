import { AUDIBLE_REGIONS, type AudibleRegion } from '@bookorbit/types';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class LookupBookChaptersDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z0-9]{10}$/)
  asin!: string;

  @IsOptional()
  @IsIn(AUDIBLE_REGIONS)
  region?: AudibleRegion;
}
