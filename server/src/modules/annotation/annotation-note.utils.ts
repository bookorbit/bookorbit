/**
 * A note that is empty or only whitespace is stored as no note. Clients disagreed: the web kept `''`, KOReader kept
 * spaces, iOS and the Kobo dropped both, so the same highlight was a note on some devices and plain on others.
 */
export function normalizeAnnotationNote(note: string | null | undefined): string | null {
  return note != null && note.trim() !== '' ? note : null;
}
