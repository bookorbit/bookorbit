import { IsOptional, IsString } from 'class-validator';

export class UpdateAnnotationDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  style?: string;
}
