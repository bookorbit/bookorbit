import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateBookmarkDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  bookFileId?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  cfi!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;
}
