import { describe, expect, it } from 'vitest';

import { normalizeAnnotationNote } from './annotation-note.utils';

describe('normalizeAnnotationNote', () => {
  it('treats missing, empty and whitespace-only notes as no note', () => {
    expect(normalizeAnnotationNote(undefined)).toBeNull();
    expect(normalizeAnnotationNote(null)).toBeNull();
    expect(normalizeAnnotationNote('')).toBeNull();
    expect(normalizeAnnotationNote(' \n\t  ')).toBeNull();
  });

  it('keeps a note with text exactly as written, line breaks and padding included', () => {
    expect(normalizeAnnotationNote('  one\n\ntwo  ')).toBe('  one\n\ntwo  ');
  });
});
