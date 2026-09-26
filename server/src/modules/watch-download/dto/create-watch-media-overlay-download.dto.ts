import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateWatchMediaOverlayDownloadDto {
  @IsInt()
  @Min(1)
  bookId!: number;

  @IsInt()
  @Min(1)
  fileId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2048)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  hrefs!: string[];
}
