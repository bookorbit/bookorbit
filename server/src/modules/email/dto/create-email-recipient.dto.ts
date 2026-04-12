import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

import { RECIPIENT_DEVICE_TYPES, RECIPIENT_FORMATS } from './email-recipient.constants';

export class CreateEmailRecipientDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsIn(RECIPIENT_DEVICE_TYPES)
  deviceType?: string;

  @IsOptional()
  @IsIn(RECIPIENT_FORMATS)
  preferredFormat?: string;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number;
}
