import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { METADATA_HTTP_PROVIDER_TIMEOUT_MS } from '@bookorbit/types';
import type { CreateMetadataHttpProviderPayload, UpdateMetadataHttpProviderPayload } from '@bookorbit/types';

const MAX_URL_LENGTH = 2048;
const MAX_AUTHORIZATION_LENGTH = 4096;

export class CreateMetadataHttpProviderDto implements CreateMetadataHttpProviderPayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_URL_LENGTH)
  baseUrl!: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(MAX_AUTHORIZATION_LENGTH)
  authorization?: string | null;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @IsInt()
  @Min(METADATA_HTTP_PROVIDER_TIMEOUT_MS.min)
  @Max(METADATA_HTTP_PROVIDER_TIMEOUT_MS.max)
  timeoutMs?: number;
}

export class UpdateMetadataHttpProviderDto implements UpdateMetadataHttpProviderPayload {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_URL_LENGTH)
  baseUrl?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(MAX_AUTHORIZATION_LENGTH)
  authorization?: string | null;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @IsInt()
  @Min(METADATA_HTTP_PROVIDER_TIMEOUT_MS.min)
  @Max(METADATA_HTTP_PROVIDER_TIMEOUT_MS.max)
  timeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class TestMetadataHttpProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;
}

export class DeleteMetadataHttpProviderQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  purge?: boolean;
}
