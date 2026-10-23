import type { EmailPreferencesUpdateRequest } from '@bookorbit/types';
import { IsInt, IsOptional } from 'class-validator';

export class UpdateEmailPreferencesDto implements EmailPreferencesUpdateRequest {
  @IsOptional()
  @IsInt()
  defaultProviderId?: number | null;

  @IsOptional()
  @IsInt()
  defaultRecipientId?: number | null;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number | null;
}
