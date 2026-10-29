import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { METADATA_CACHE_REQUEST_POLICIES, type MetadataProviderKey } from '@bookorbit/types';

import { IsMetadataProviderKey } from '../../../common/decorators/is-metadata-provider-key.decorator';
import type { MetadataCacheRequestPolicy } from '@bookorbit/types';

export class LookupMetadataDto {
  @IsMetadataProviderKey()
  provider: MetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  // External providers may use ids up to 512 characters.
  @MaxLength(512)
  id: string;

  /** `refresh` asks the provider live instead of answering from the metadata cache. */
  @IsOptional()
  @IsIn(METADATA_CACHE_REQUEST_POLICIES)
  cache?: MetadataCacheRequestPolicy;
}
