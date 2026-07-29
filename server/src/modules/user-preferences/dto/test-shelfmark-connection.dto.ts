import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class TestShelfmarkConnectionDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url!: string;
}
