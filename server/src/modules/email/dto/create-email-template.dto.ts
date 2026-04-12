import { IsString, MaxLength } from 'class-validator';

export class CreateEmailTemplateDto {
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
