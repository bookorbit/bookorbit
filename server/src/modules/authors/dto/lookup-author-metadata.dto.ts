import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthorMetadataProviderKey } from '@bookorbit/types';

export class LookupAuthorMetadataDto {
  @IsEnum(AuthorMetadataProviderKey)
  provider!: AuthorMetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  region?: string;
}
