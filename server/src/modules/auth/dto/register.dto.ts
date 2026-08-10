import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import {
  DISPLAY_SAFE_TEXT_MESSAGE,
  DISPLAY_SAFE_TEXT_PATTERN,
  TRIMMED_TEXT_MESSAGE,
  TRIMMED_TEXT_PATTERN,
} from '../../../common/constants/display-safe-text.constants';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Matches(DISPLAY_SAFE_TEXT_PATTERN, { message: `username ${DISPLAY_SAFE_TEXT_MESSAGE}` })
  @Matches(TRIMMED_TEXT_PATTERN, { message: `username ${TRIMMED_TEXT_MESSAGE}` })
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(DISPLAY_SAFE_TEXT_PATTERN, { message: `name ${DISPLAY_SAFE_TEXT_MESSAGE}` })
  @Matches(TRIMMED_TEXT_PATTERN, { message: `name ${TRIMMED_TEXT_MESSAGE}` })
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1024)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  })
  password: string;
}
