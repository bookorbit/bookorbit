import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class AdoptDownloadClientItemDto {
  @IsInt()
  @Min(1)
  downloadId!: number;
}

export class RemoveOrphanedDownloadClientItemDto {
  @IsOptional()
  @IsBoolean()
  deleteFiles?: boolean;
}
