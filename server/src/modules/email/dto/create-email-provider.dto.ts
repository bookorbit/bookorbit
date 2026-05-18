import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateEmailProviderDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(253)
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromAddress?: string;

  @IsBoolean()
  auth: boolean;

  @IsBoolean()
  ssl: boolean;

  @IsBoolean()
  startTls: boolean;

  @IsBoolean()
  tlsRejectUnauthorized: boolean;
}
