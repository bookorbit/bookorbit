import type { RevertBookChaptersRequest } from '@bookorbit/types';
import { IsString, Matches } from 'class-validator';

export class RevertBookChaptersDto implements RevertBookChaptersRequest {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  baseRevision!: string;
}
