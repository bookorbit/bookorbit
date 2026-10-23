import { IsBoolean, IsDefined, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { READ_ALOUD_DELIVERY_VARIANTS, type ReadAloudDeliveryPreference } from '@bookorbit/types';

export class UpdateKoreaderDeliverySettingsDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsIn(READ_ALOUD_DELIVERY_VARIANTS)
  readAloudDelivery!: ReadAloudDeliveryPreference;
}

export class MigrateKoreaderDeliverySettingsDto extends UpdateKoreaderDeliverySettingsDto {
  @IsOptional()
  @IsBoolean()
  migrateOnly?: boolean;
}
