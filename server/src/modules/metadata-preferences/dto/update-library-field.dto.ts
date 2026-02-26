import { IsIn, IsBoolean, IsArray, IsString } from 'class-validator';
import { MetadataProviderKey } from '@projectx/types';
import type { MergeStrategy } from '@projectx/types';

const MERGE_STRATEGIES: MergeStrategy[] = ['fillMissing', 'overwrite', 'overwriteIfProvided'];
const PROVIDER_KEYS = Object.values(MetadataProviderKey);

export class UpdateLibraryFieldDto {
  @IsBoolean() enabled!: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsIn(PROVIDER_KEYS, { each: true })
  providers!: MetadataProviderKey[];

  @IsIn(MERGE_STRATEGIES)
  mergeStrategy!: MergeStrategy;
}
