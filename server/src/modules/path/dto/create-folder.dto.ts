import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  parentPath: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
