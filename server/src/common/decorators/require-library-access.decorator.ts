import { SetMetadata } from '@nestjs/common';
import type { AccessLevel } from '@projectx/types';

export const LIBRARY_ACCESS_KEY = 'libraryAccess';
export type LibraryAccessLevel = AccessLevel;
export const RequireLibraryAccess = (level: LibraryAccessLevel) => SetMetadata(LIBRARY_ACCESS_KEY, level);
