import { IsString, MinLength } from 'class-validator';

export class UpdateAppSettingDto {
  @IsString()
  @MinLength(1)
  value: string;
}
