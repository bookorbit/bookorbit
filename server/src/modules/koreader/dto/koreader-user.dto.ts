import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateKoreaderUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}

export class UpdateKoreaderUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @IsOptional()
  username?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  @IsOptional()
  password?: string;

  @IsBoolean()
  @IsOptional()
  syncEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  discardBackwardProgress?: boolean;
}

export class TestConnectionDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}
