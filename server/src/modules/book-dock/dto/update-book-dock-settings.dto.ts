import { IsBoolean, IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';

import type { BookDockAutoFinalizeMetadataMode, UpdateBookDockSettingsRequest } from '@bookorbit/types';

const AUTO_FINALIZE_METADATA_MODES: BookDockAutoFinalizeMetadataMode[] = ['safe_merge', 'fetched_only', 'embedded_only'];

export class UpdateBookDockSettingsDto implements UpdateBookDockSettingsRequest {
  @IsBoolean()
  autoFetchMetadata!: boolean;

  @IsBoolean()
  autoFinalizeEnabled!: boolean;

  @IsInt()
  @Min(50)
  @Max(100)
  autoFinalizeThreshold!: number;

  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  autoFinalizeLibraryId!: number | null;

  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  autoFinalizeFolderId!: number | null;

  @IsIn(AUTO_FINALIZE_METADATA_MODES)
  autoFinalizeMetadataMode!: BookDockAutoFinalizeMetadataMode;
}
