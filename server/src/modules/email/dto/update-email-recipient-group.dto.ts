import type { EmailRecipientGroupUpdateRequest } from '@bookorbit/types';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmailRecipientGroupDto implements EmailRecipientGroupUpdateRequest {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number | null;
}
