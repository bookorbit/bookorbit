import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { MAX_INDEXER_RELEASE_GUID_LENGTH, type InspectBookRequestReleasePayload } from '@bookorbit/types';

export class InspectBookRequestReleaseDto implements InspectBookRequestReleasePayload {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  indexerId!: number;

  @IsString()
  @MaxLength(MAX_INDEXER_RELEASE_GUID_LENGTH)
  releaseGuid!: string;
}
