import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

export class ClaimMappingDto {
  @IsString()
  @MaxLength(256)
  username: string;

  @IsString()
  @MaxLength(256)
  name: string;

  @IsString()
  @MaxLength(256)
  email: string;

  @IsString()
  @MaxLength(256)
  groups: string;
}

export class AutoProvisionDto {
  @IsBoolean()
  enabled: boolean;

  @IsBoolean()
  allowLocalLinking: boolean;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  defaultPermissionNames: string[] = [];
}

export class UpdateOidcConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  issuerUri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  scopes?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  iconUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClaimMappingDto)
  claimMapping?: ClaimMappingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AutoProvisionDto)
  autoProvision?: AutoProvisionDto;
}
