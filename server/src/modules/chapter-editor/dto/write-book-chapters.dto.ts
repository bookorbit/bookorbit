import type { WriteBookChaptersRequest } from '@bookorbit/types';
import { IsString, Matches } from 'class-validator';

export class WriteBookChaptersDto implements WriteBookChaptersRequest {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  baseRevision!: string;
}
