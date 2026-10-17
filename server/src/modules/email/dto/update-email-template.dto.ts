import type { EmailTemplateUpdateRequest } from '@bookorbit/types';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmailTemplateDto implements EmailTemplateUpdateRequest {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(998)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  bodyText?: string;
}
