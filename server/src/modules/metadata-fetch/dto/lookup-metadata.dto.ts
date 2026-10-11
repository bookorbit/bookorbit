import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { METADATA_CACHE_REQUEST_POLICIES, MetadataProviderKey } from '@bookorbit/types';
import type { MetadataCacheRequestPolicy } from '@bookorbit/types';

export class LookupMetadataDto {
  @IsEnum(MetadataProviderKey)
  provider: MetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  id: string;

  /** `refresh` asks the provider live instead of answering from the metadata cache. */
  @IsOptional()
  @IsIn(METADATA_CACHE_REQUEST_POLICIES)
  cache?: MetadataCacheRequestPolicy;
}
