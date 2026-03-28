import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class UpsertAudioProgressDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @IsInt()
  @Min(1)
  currentFileId!: number;

  @IsNumber()
  @Min(0)
  positionSeconds!: number;
}
