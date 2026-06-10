import { IsString, MaxLength, MinLength } from 'class-validator';

export class DownloadPluginPackageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  origin!: string;
}
