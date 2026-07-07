import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertStorygraphSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  sessionCookie?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  rememberToken?: string;

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
}

export class ValidateStorygraphCookiesDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  sessionCookie?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  rememberToken?: string;
}

export class LinkStorygraphBookDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2048)
  input!: string;
}

export class SetStorygraphEditionDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(64)
  editionId!: string;
}

export class UpdateStorygraphBookSyncDto {
  @IsBoolean()
  syncEnabled!: boolean;
}
