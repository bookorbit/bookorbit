import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateAudiobookBookmarkDto {
  @IsUUID()
  clientId!: string;

  @IsInt()
  @Min(0)
  positionMs!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  chapterId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}
