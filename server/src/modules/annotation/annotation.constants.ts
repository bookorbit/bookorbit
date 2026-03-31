export const DEFAULT_ANNOTATION_COLOR = 'yellow';
export const DEFAULT_ANNOTATION_STYLE = 'highlight';
export const ANNOTATION_STYLES = ['highlight', 'underline', 'strikethrough', 'squiggly'] as const;
export type AnnotationStyle = (typeof ANNOTATION_STYLES)[number];
