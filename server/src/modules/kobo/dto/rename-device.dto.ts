import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;
}
