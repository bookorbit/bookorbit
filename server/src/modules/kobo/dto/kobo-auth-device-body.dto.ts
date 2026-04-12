import { IsOptional, IsString } from 'class-validator';

export class KoboAuthDeviceBodyDto {
  @IsString()
  @IsOptional()
  UserKey?: string;
}
