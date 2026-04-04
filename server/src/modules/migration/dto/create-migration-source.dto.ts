import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class CreateMigrationSourceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsObject()
  connectionConfig!: Record<string, unknown>;
}
