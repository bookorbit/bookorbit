import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class TestMigrationSourceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type!: string;

  @IsObject()
  connectionConfig!: Record<string, unknown>;
}
