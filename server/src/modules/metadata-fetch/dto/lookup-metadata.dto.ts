import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { MetadataProviderKey } from '@projectx/types';

export class LookupMetadataDto {
  @IsEnum(MetadataProviderKey)
  provider: MetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  id: string;
}
