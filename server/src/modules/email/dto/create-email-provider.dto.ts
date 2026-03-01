import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateEmailProviderDto {
  @IsString()
  name: string;

  @IsString()
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsOptional()
  @IsString()
  fromAddress?: string;

  @IsBoolean()
  auth: boolean;

  @IsBoolean()
  ssl: boolean;

  @IsBoolean()
  startTls: boolean;
}
