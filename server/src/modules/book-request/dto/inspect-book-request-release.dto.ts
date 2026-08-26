import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import type { InspectBookRequestReleasePayload } from '@bookorbit/types';

export class InspectBookRequestReleaseDto implements InspectBookRequestReleasePayload {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  indexerId!: number;

  @IsString()
  @MaxLength(500)
  releaseGuid!: string;
}
