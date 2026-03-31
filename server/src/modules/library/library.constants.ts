import type { AccessLevel, CoverAspectRatio, OrganizationMode } from '@projectx/types';

export const LIBRARY_ACCESS_LEVELS = ['viewer', 'editor', 'owner'] as const satisfies readonly AccessLevel[];
export const LIBRARY_COVER_ASPECT_RATIOS = ['2/3', '1/1'] as const satisfies readonly CoverAspectRatio[];
export const LIBRARY_ORGANIZATION_MODES = ['book_per_file', 'book_per_folder'] as const satisfies readonly OrganizationMode[];

export const DEFAULT_LIBRARY_ORGANIZATION_MODE: OrganizationMode = 'book_per_folder';
export const DEFAULT_LIBRARY_COVER_ASPECT_RATIO: CoverAspectRatio = '2/3';

export const LIBRARY_AUTO_SCAN_CRON_EXPRESSION_REGEX = /^((\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)? ){4}(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;
export const LIBRARY_AUTO_SCAN_CRON_EXPRESSION_ERROR = 'autoScanCronExpression must be a valid 5-field cron expression';

export const LIBRARY_READING_THRESHOLD_MIN = 0.05;
export const LIBRARY_READING_THRESHOLD_MAX = 5;
export const LIBRARY_MARK_AS_FINISHED_MIN = 90;
export const LIBRARY_MARK_AS_FINISHED_MAX = 100;

export const LIBRARY_BOOK_STATUS_PRESENT = 'present';
export const LIBRARY_METADATA_PRECEDENCE_DEFAULT = ['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar'] as const;
