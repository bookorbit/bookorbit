import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

import type { BookDockAutoFinalizeMetadataMode, UpdateLibraryDockRequest } from '@bookorbit/types';

const AUTO_FINALIZE_METADATA_MODES: BookDockAutoFinalizeMetadataMode[] = ['safe_merge', 'fetched_only', 'embedded_only'];

/** Present means "set it"; absent leaves it alone. Null is not a value for these. */
const isPresent = (_: unknown, value: unknown) => value !== undefined;

/** Overrides take `null` to go back to inheriting the global setting. */
export class UpdateLibraryDockDto implements UpdateLibraryDockRequest {
  @ValidateIf(isPresent)
  @IsBoolean()
  enabled?: boolean;

  @ValidateIf(isPresent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  folderName?: string;

  @ValidateIf(isPresent)
  @IsInt()
  @Min(1)
  targetFolderId?: number;

  @IsOptional()
  @IsBoolean()
  autoFetchMetadata?: boolean | null;

  @IsOptional()
  @IsBoolean()
  autoFinalizeEnabled?: boolean | null;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(100)
  autoFinalizeThreshold?: number | null;

  @IsOptional()
  @IsIn(AUTO_FINALIZE_METADATA_MODES)
  autoFinalizeMetadataMode?: BookDockAutoFinalizeMetadataMode | null;

  @ValidateIf(isPresent)
  @IsBoolean()
  autoJoin?: boolean;

  @ValidateIf(isPresent)
  @IsBoolean()
  keepOriginal?: boolean;
}

/** Without a name, the folder takes the name the library's current name gives. */
export class RenameLibraryDockFolderDto {
  @ValidateIf(isPresent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  folderName?: string;
}

/** A folder directly in `_libraries`, by its name on disk. */
export class LibraryDockFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  folderName!: string;
}

export class AdoptLibraryDockFolderDto extends LibraryDockFolderDto {
  @IsInt()
  @Min(1)
  libraryId!: number;
}
