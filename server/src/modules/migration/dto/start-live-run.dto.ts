import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class StartLiveRunDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planArtifactId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetKey?: string;
}
