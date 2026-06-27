export const DEFAULT_ANNOTATION_COLOR = 'yellow';
export const DEFAULT_ANNOTATION_STYLE = 'highlight';
export const ANNOTATION_STYLES = ['highlight', 'underline', 'strikethrough', 'squiggly', 'invert'] as const;
export type AnnotationStyle = (typeof ANNOTATION_STYLES)[number];

export const ANNOTATION_ORIGINS = ['web', 'koreader', 'kobo'] as const;
export type AnnotationOrigin = (typeof ANNOTATION_ORIGINS)[number];

export const ANNOTATION_POSITION_FORMATS = ['cfi', 'xpointer', 'pdf', 'kobo_span'] as const;
export type AnnotationPositionFormat = (typeof ANNOTATION_POSITION_FORMATS)[number];

export const ANNOTATION_POSITION_STATUSES = ['exact', 'repaired', 'failed', 'pending'] as const;
export type AnnotationPositionStatus = (typeof ANNOTATION_POSITION_STATUSES)[number];

export const ANNOTATION_SYNC_SOURCES = ['koreader', 'kobo'] as const;
export type AnnotationSyncSource = (typeof ANNOTATION_SYNC_SOURCES)[number];
