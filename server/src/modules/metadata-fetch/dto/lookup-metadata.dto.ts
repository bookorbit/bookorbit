import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

import { MetadataProviderKey } from '@projectx/types';

export class LookupMetadataDto {
  @IsEnum(MetadataProviderKey)
  provider: MetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  id: string;
}
