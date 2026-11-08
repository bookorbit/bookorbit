import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import {
  API_KEY_ACCESS_LEVELS,
  API_KEY_EXPIRY_PRESETS,
  API_KEY_GRANTABLE_PERMISSIONS,
  API_KEY_MAX_LIBRARIES,
  API_KEY_NAME_MAX_LENGTH,
  type ApiKeyAccess,
  type CreateApiKeyRequest,
  type RenameApiKeyRequest,
} from '@bookorbit/types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const EXPIRY_DAYS = API_KEY_EXPIRY_PRESETS.filter((days): days is Exclude<typeof days, null> => days !== null);

export class CreateApiKeyDto implements CreateApiKeyRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(API_KEY_NAME_MAX_LENGTH)
  name: string;

  /** Omitted: the default lifetime. Null: never expires. */
  @IsOptional()
  @IsIn(EXPIRY_DAYS)
  expiresInDays?: number | null;

  @IsOptional()
  @IsIn(API_KEY_ACCESS_LEVELS)
  access?: ApiKeyAccess;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_GRANTABLE_PERMISSIONS.length)
  @IsIn(API_KEY_GRANTABLE_PERMISSIONS, { each: true })
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  admin?: boolean;

  /** Omitted or null: every library the owner can see. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_MAX_LIBRARIES)
  @IsInt({ each: true })
  @Min(1, { each: true })
  libraryIds?: number[] | null;
}

export class RenameApiKeyDto implements RenameApiKeyRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(API_KEY_NAME_MAX_LENGTH)
  name: string;
}
