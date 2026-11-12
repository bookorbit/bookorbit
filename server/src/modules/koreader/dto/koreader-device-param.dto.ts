import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { KOREADER_DEVICE_NAME_MAX_LENGTH } from '@bookorbit/types';

export const KOREADER_DEVICE_ID_REGEX = /^[A-Za-z0-9_-]{1,100}$/;

// A name is shown on one line everywhere, KOReader's toasts included, so control characters are refused.
const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]*$/u;

export class KoreaderDeviceParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(KOREADER_DEVICE_ID_REGEX)
  deviceId!: string;
}

export class UpdateKoreaderDeviceDto {
  @IsBoolean()
  retired!: boolean;
}

export class UpdateKoreaderDeviceNameDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(KOREADER_DEVICE_NAME_MAX_LENGTH)
  @Matches(NO_CONTROL_CHARACTERS)
  name!: string;
}
