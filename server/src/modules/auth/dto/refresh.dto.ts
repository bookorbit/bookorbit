import { IsOptional, IsString, Matches } from 'class-validator';

export class RefreshDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  refreshToken?: string;
}
