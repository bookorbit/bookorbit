import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { LOCATE_TEXT_MAX_LENGTH, type LocateTextRequest } from '@bookorbit/types';

export class LocateTextDto implements LocateTextRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOCATE_TEXT_MAX_LENGTH)
  text!: string;
}
