import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

const VALID_STATUSES = ['pending', 'ready', 'error'] as const;
const VALID_SORT_FIELDS = ['createdAt', 'fileName', 'format', 'status', 'fileSize'] as const;
const VALID_ORDERS = ['asc', 'desc'] as const;

export class ListBookBucketFilesDto {
  @IsOptional()
  @IsIn(VALID_STATUSES)
  status?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsIn(VALID_SORT_FIELDS)
  sort?: string = 'createdAt';

  @IsOptional()
  @IsIn(VALID_ORDERS)
  order?: string = 'desc';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;
}
