import { IsInt, IsOptional } from 'class-validator';

export class UpdateEmailPreferencesDto {
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
