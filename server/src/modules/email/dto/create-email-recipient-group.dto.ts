import type { EmailRecipientGroupCreateRequest } from '@bookorbit/types';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEmailRecipientGroupDto implements EmailRecipientGroupCreateRequest {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number;
}
