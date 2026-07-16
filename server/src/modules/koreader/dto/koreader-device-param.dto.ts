import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const KOREADER_DEVICE_ID_REGEX = /^[A-Za-z0-9-]{1,100}$/;

export class KoreaderDeviceParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(KOREADER_DEVICE_ID_REGEX)
  deviceId!: string;
}
