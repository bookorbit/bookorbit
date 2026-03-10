import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class SetupDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  })
  password: string;
}
