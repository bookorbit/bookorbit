import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';

class ClaimMappingDto {
  @IsString()
  username: string;

  @IsString()
  name: string;

  @IsString()
  email: string;

  @IsString()
  groups: string;
}

class AutoProvisionDto {
  @IsBoolean()
  enabled: boolean;

  @IsBoolean()
  allowLocalLinking: boolean;

  @IsOptional()
  @IsInt()
  @IsPositive()
  defaultRoleId: number | null;
}

export class UpdateOidcConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  providerName?: string;

  @IsOptional()
  @IsString()
  issuerUri?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  scopes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClaimMappingDto)
  claimMapping?: ClaimMappingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AutoProvisionDto)
  autoProvision?: AutoProvisionDto;
}
