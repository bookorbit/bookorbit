import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

import { RECIPIENT_DEVICE_TYPES, RECIPIENT_FORMATS } from './email-recipient.constants';

export class UpdateEmailRecipientDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn([...RECIPIENT_DEVICE_TYPES, null])
  deviceType?: string | null;

  @IsOptional()
  @IsIn([...RECIPIENT_FORMATS, null])
  preferredFormat?: string | null;

  @IsOptional()
  @IsInt()
  defaultTemplateId?: number | null;
}
