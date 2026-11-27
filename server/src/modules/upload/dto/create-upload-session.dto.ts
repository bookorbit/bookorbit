import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

export class UploadTargetDto {
  @IsIn(['library', 'existing_book', 'book_dock', 'book_request'])
  kind!: 'library' | 'existing_book' | 'book_dock' | 'book_request';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  libraryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  folderId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookId?: number;

  /** A `book_request` target's manifest entry. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  requestFileId?: number;
}

export class CreateUploadSessionDto {
  @IsString()
  @MaxLength(500)
  filename!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,100}$/)
  idempotencyKey!: string;

  @ValidateNested()
  @Type(() => UploadTargetDto)
  target!: UploadTargetDto;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @IsOptional()
  @Matches(/^[a-fA-F0-9]{64}$/)
  sha256?: string;
}
