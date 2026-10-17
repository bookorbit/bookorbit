import type { EmailTemplateCreateRequest } from '@bookorbit/types';
import { IsString, MaxLength } from 'class-validator';

export class CreateEmailTemplateDto implements EmailTemplateCreateRequest {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(998)
  subject: string;

  @IsString()
  @MaxLength(200_000)
  bodyText: string;
}
