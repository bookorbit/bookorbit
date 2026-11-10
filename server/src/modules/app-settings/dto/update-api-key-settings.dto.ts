import { IsBoolean, IsInt, Max, Min, ValidateIf } from 'class-validator';

import { MAX_API_KEY_LIFETIME_CAP_DAYS } from '../../../common/constants/app-settings.constants';

export class UpdateApiKeySettingsDto {
  @IsBoolean()
  enabled: boolean;

  /** Null removes the limit. */
  @ValidateIf((dto: UpdateApiKeySettingsDto) => dto.maxLifetimeDays !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_API_KEY_LIFETIME_CAP_DAYS)
  maxLifetimeDays: number | null;
}
