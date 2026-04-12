import { IsOptional, IsString } from 'class-validator';

export class KoboAuthRefreshBodyDto {
  @IsString()
  @IsOptional()
  RefreshToken?: string;
}
