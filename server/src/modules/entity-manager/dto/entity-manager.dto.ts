import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ScanDuplicatesDto {
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  libraryId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(1.0)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  minSimilarity?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  pageSize?: number;
}

export class BrowseEntitiesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  pageSize?: number;

  @IsOptional()
  @IsIn(['name', 'bookCount'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;
}

export class MergeEntitiesDto {
  @IsOptional()
  @IsNumber()
  targetEntityId?: number;

  @IsOptional()
  @IsString()
  targetValue?: string;

  @IsOptional()
  @IsNumber({}, { each: true })
  sourceEntityIds?: number[];

  @IsOptional()
  @IsString({ each: true })
  sourceValues?: string[];

  @IsOptional()
  writeFiles?: boolean;
}

export class RenameEntityDto {
  @IsOptional()
  @IsNumber()
  entityId?: number;

  @IsOptional()
  @IsString()
  currentValue?: string;

  @IsString()
  newName!: string;

  @IsOptional()
  writeFiles?: boolean;
}

export class DeleteEntityDto {
  @IsOptional()
  @IsNumber()
  entityId?: number;

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsIn(['soft', 'hard', 'inline'])
  mode?: 'soft' | 'hard' | 'inline';

  @IsOptional()
  writeFiles?: boolean;
}

export class BulkDeleteEntitiesDto {
  @IsOptional()
  @IsNumber({}, { each: true })
  entityIds?: number[];

  @IsOptional()
  @IsString({ each: true })
  values?: string[];

  @IsOptional()
  @IsIn(['soft', 'hard', 'inline'])
  mode?: 'soft' | 'hard' | 'inline';

  @IsOptional()
  writeFiles?: boolean;
}

export class SplitEntityDto {
  @IsNumber()
  entityId!: number;

  @IsString({ each: true })
  newNames!: string[];

  @IsOptional()
  writeFiles?: boolean;
}

export class DismissPairDto {
  @IsOptional()
  @IsNumber()
  entityIdA?: number;

  @IsOptional()
  @IsNumber()
  entityIdB?: number;

  @IsOptional()
  @IsString()
  valueA?: string;

  @IsOptional()
  @IsString()
  valueB?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UndismissPairDto {
  @IsOptional()
  @IsNumber()
  entityIdA?: number;

  @IsOptional()
  @IsNumber()
  entityIdB?: number;

  @IsOptional()
  @IsString()
  valueA?: string;

  @IsOptional()
  @IsString()
  valueB?: string;
}
