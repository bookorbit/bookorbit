import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { LibraryType } from '@bookorbit/types';

export const LIBRARY_TYPE_KEY = 'libraryType';
export const OPTIONAL_LIBRARY_TYPE_KEY = 'optionalLibraryType';

export const RequireLibraryType = (type: LibraryType, options: { optional?: boolean } = {}) =>
  applyDecorators(SetMetadata(LIBRARY_TYPE_KEY, type), SetMetadata(OPTIONAL_LIBRARY_TYPE_KEY, options.optional === true));
