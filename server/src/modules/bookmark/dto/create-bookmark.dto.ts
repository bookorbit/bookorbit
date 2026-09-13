import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateBookmarkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  cfi!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;
}
