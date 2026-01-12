import { SetMetadata } from '@nestjs/common';

export const LIBRARY_ACCESS_KEY = 'libraryAccess';
export const RequireLibraryAccess = (level: 'viewer' | 'editor' | 'owner') => SetMetadata(LIBRARY_ACCESS_KEY, level);
