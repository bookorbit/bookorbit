import { IsEmail, IsOptional, MaxLength } from 'class-validator';

export class KindleRecipientDto {
  @IsOptional()
  @IsEmail({}, { message: 'INVALID_KINDLE_EMAIL' })
  @MaxLength(255, { message: 'INVALID_KINDLE_EMAIL' })
  kindleEmail?: string;
}
