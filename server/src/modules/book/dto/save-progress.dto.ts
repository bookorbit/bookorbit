import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SaveProgressDto {
  @IsOptional()
  @IsString()
  cfi?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;
}
