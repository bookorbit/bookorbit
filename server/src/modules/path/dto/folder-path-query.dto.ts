import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FolderPathQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  path?: string;
}
