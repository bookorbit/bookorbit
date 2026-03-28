import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBookmarkDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cfi?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsNumber()
  positionSeconds?: number;
}
