import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class UpdateBookFileDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  filename?: string;
}
