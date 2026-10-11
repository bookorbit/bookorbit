import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthorMetadataProviderKey, METADATA_CACHE_REQUEST_POLICIES, type MetadataCacheRequestPolicy } from '@bookorbit/types';

export class LookupAuthorMetadataDto {
  @IsEnum(AuthorMetadataProviderKey)
  provider!: AuthorMetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  region?: string;

  /**
   * `refresh` skips a saved answer and asks the provider live. Clients must only send it to servers
   * advertising the `metadata-search-cache` feature.
   */
  @IsOptional()
  @IsIn(METADATA_CACHE_REQUEST_POLICIES)
  cache?: MetadataCacheRequestPolicy;
}
