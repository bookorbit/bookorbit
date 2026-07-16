import { IsNotEmpty, IsString } from 'class-validator';

export class TestShelfmarkConnectionDto {
  @IsString()
  @IsNotEmpty()
  url!: string;
}
