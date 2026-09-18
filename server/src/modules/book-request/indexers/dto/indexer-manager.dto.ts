import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { INDEXER_COLORS, INDEXER_MANAGER_TYPES } from '@bookorbit/types';
import type { IndexerColor, IndexerManagerType } from '@bookorbit/types';

import { NetworkProfileDto } from './indexer.dto';

export class CreateIndexerManagerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn(INDEXER_MANAGER_TYPES)
  type!: IndexerManagerType;

  @IsString()
  @MaxLength(2048)
  baseUrl!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  credential!: string;

  @IsOptional()
  @IsIn(INDEXER_COLORS)
  color?: IndexerColor | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  syncNewIndexers?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  perIndexerTimeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  overallSearchBudgetSeconds?: number;

  @IsOptional()
  @IsBoolean()
  autoExpandCategories?: boolean;

  @IsOptional()
  @IsBoolean()
  inheritSeedLimits?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => NetworkProfileDto)
  networkProfile?: NetworkProfileDto | null;
}

export class UpdateIndexerManagerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  credential?: string;

  @IsOptional()
  @IsIn(INDEXER_COLORS)
  color?: IndexerColor | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPrivateAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  syncNewIndexers?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  perIndexerTimeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  overallSearchBudgetSeconds?: number;

  @IsOptional()
  @IsBoolean()
  autoExpandCategories?: boolean;

  @IsOptional()
  @IsBoolean()
  inheritSeedLimits?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => NetworkProfileDto)
  networkProfile?: NetworkProfileDto | null;
}

export class UpdateManagedIndexerSourceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(INDEXER_COLORS)
  color?: IndexerColor | null;
}
