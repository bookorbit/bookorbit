import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class StartDownloadDto {
  @IsString()
  @Length(32, 32)
  @Matches(/^[a-f0-9]{32}$/, { message: 'md5 must be a valid MD5 hash' })
  md5!: string;

  @IsInt()
  @Min(1)
  libraryId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  folderId?: number;

  @IsString()
  filename!: string;
}
