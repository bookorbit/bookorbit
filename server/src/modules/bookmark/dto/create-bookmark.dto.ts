import { IsNotEmpty, IsString } from 'class-validator';

export class CreateBookmarkDto {
  @IsString()
  @IsNotEmpty()
  cfi!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;
}
