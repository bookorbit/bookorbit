import { IsString, MinLength } from 'class-validator';

export class OidcUnlinkDto {
  @IsString()
  @MinLength(1)
  password: string;
}
