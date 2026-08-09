import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import type { ApplyHardcoverImportPayload, SetHardcoverEditionPayload, UpdateHardcoverBookSyncPayload } from '@bookorbit/types';

export class UpsertHardcoverSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  apiToken?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['all_eligible', 'selected_only'])
  bookSyncMode?: 'all_eligible' | 'selected_only';

  @IsOptional()
  @IsBoolean()
  autoSyncOnStatusChange?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncOnProgressUpdate?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncOnRatingChange?: boolean;

  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3])
  privacySettingId?: number;
}

export class ValidateHardcoverTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  token?: string;
}

export class UpdateHardcoverBookSyncDto implements UpdateHardcoverBookSyncPayload {
  @IsBoolean()
  syncEnabled!: boolean;
}

export class SetHardcoverEditionDto implements SetHardcoverEditionPayload {
  @IsInt()
  @Min(1)
  editionId!: number;
}

export class ApplyHardcoverImportDto implements ApplyHardcoverImportPayload {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  hardcoverUserBookIds?: number[];

  @IsOptional()
  @IsBoolean()
  importProgress?: boolean;
}
