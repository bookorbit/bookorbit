import { IsIn } from 'class-validator';
import type { AccessLevel } from '@projectx/types';

import { LIBRARY_ACCESS_LEVELS } from '../library.constants';

export class UpdateLibraryAccessDto {
  @IsIn(LIBRARY_ACCESS_LEVELS)
  accessLevel: AccessLevel;
}
