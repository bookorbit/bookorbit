import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min } from 'class-validator';

export class CreateWatchDownloadDto {
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileIds!: number[];
}
