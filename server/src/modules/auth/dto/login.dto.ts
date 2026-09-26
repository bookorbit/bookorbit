import { AuthClientDto } from './auth-client.dto';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto extends AuthClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password: string;
}
