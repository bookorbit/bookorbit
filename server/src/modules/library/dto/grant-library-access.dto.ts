import { IsIn, IsInt, IsPositive } from 'class-validator';
import type { AccessLevel } from '@projectx/types';

import { LIBRARY_ACCESS_LEVELS } from '../library.constants';

export class GrantLibraryAccessDto {
  @IsInt()
  @IsPositive()
  userId: number;

  @IsIn(LIBRARY_ACCESS_LEVELS)
  accessLevel: AccessLevel;
}
