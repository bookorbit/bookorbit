/**
 * The i18n key naming where a highlight was made. Highlights from the web reader and the phone apps
 * are both stored as `web`, so that origin reads as BookOrbit rather than as the browser.
 */
export function annotationSourceKey(origin: string): string {
  return origin === 'web' ? 'annotations.sources.bookorbit' : `annotations.sources.${origin}`
}
