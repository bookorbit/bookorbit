import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SaveTtsPositionDto {
  @IsString()
  @IsNotEmpty()
  cfi!: string;

  @IsOptional()
  @IsInt()
  chapterIndex?: number;
}
