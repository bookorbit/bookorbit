import { SetMetadata } from '@nestjs/common';

export const LIBRARY_ACCESS_KEY = 'libraryAccess';
export type LibraryAccessLevel = 'viewer' | 'editor' | 'owner';
export const RequireLibraryAccess = (level: LibraryAccessLevel) => SetMetadata(LIBRARY_ACCESS_KEY, level);
