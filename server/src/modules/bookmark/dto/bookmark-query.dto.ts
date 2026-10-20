import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class BookmarkQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readerFileId?: number;
}
