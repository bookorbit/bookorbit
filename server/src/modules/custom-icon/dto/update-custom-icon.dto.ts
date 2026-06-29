import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CUSTOM_ICON_NAME_MAX_LENGTH } from '@bookorbit/types';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateCustomIconDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(CUSTOM_ICON_NAME_MAX_LENGTH)
  name?: string;
}
