import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { READ_ALOUD_DELIVERY_VARIANTS, type ReadAloudDeliveryPreference } from '@bookorbit/types';

export class CreateKoreaderUserDto {
  @IsOptional()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  readAloudDelivery?: ReadAloudDeliveryPreference;

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}

export class UpdateKoreaderUserDto {
  @IsOptional()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  readAloudDelivery?: ReadAloudDeliveryPreference;

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @IsOptional()
  username?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  @IsOptional()
  password?: string;

  @IsBoolean()
  @IsOptional()
  syncEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  hideAudioOnlyBooks?: boolean;
}

export class TestConnectionDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}
