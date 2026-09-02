import { IsOptional, IsString, MinLength } from 'class-validator';

export class OidcUnlinkDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}
