import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AuthorMetadataProviderKey } from '@bookorbit/types';

/** Arrived with the `author-metadata-match` server feature. */
export class PinAuthorMetadataMatchDto {
  @IsEnum(AuthorMetadataProviderKey)
  provider!: AuthorMetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  providerId!: string;
}
