import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReleaseResetHoldDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId!: string;
}
