import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OidcCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  codeVerifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  redirectUri: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  nonce: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  state: string;
}
