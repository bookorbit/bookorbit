import { parseBookFilename } from './filename-parser';

describe('parseBookFilename', () => {
  describe('title extraction', () => {
    it('extracts title from a plain filename', () => {
      const r = parseBookFilename('/books/The Great Gatsby.epub');
      expect(r.title).toBe('The Great Gatsby');
    });

    it('strips leading series index "01. "', () => {
      const r = parseBookFilename('/books/01. Dune.epub');
      expect(r.title).toBe('Dune');
    });

    it('strips multi-digit series index "003. "', () => {
      const r = parseBookFilename('/books/003. Foundation.epub');
      expect(r.title).toBe('Foundation');
    });

    it('replaces underscores with colons', () => {
      const r = parseBookFilename('/books/The_Way_of_Kings.epub');
      expect(r.title).toBe('The:Way:of:Kings');
    });

    it('handles Windows-style paths', () => {
      // basename handles both separators on all platforms via path module
      // but on Unix, backslash is not a separator, so we only test the unix separator
      const r = parseBookFilename('/library/books/My Book.pdf');
      expect(r.title).toBe('My Book');
    });
  });

  describe('year extraction', () => {
    it('extracts year from trailing "(YYYY)" suffix', () => {
      const r = parseBookFilename('/books/Dune (1965).epub');
      expect(r.publishedYear).toBe(1965);
    });

    it('returns null publishedYear when no year parenthetical', () => {
      const r = parseBookFilename('/books/Foundation.epub');
      expect(r.publishedYear).toBeNull();
    });

    it('extracts year even when followed by another parenthetical', () => {
      const r = parseBookFilename('/books/Dune (1965) (Retail).epub');
      expect(r.publishedYear).toBe(1965);
    });
  });

  describe('trailing parenthetical stripping', () => {
    it('strips a single trailing parenthetical from title', () => {
      const r = parseBookFilename('/books/Dune (1965).epub');
      expect(r.title).toBe('Dune');
    });

    it('strips multiple trailing parentheticals - year stays out of title', () => {
      // Bug regression: previously only stripped ONE parenthetical,
      // leaving "(2020)" in the title for "Title (2020) (Retail)".
      const r = parseBookFilename('/books/Neuromancer (1984) (Retail).epub');
      expect(r.title).toBe('Neuromancer');
    });

    it('strips three trailing parentheticals', () => {
      const r = parseBookFilename('/books/Book Title (Author Name) (2020) (UK).epub');
      expect(r.title).toBe('Book Title');
    });

    it('does not strip parentheticals in the middle of a title', () => {
      // "(Part 1)" is in the middle, only trailing ones are stripped
      const r = parseBookFilename('/books/Book (Part 1) Story.epub');
      expect(r.title).toBe('Book (Part 1) Story');
    });

    it('returns the stem unchanged when there are no parentheticals', () => {
      const r = parseBookFilename('/books/Simple Title.mobi');
      expect(r.title).toBe('Simple Title');
    });
  });

  describe('combined transformations', () => {
    it('strips series index AND year', () => {
      const r = parseBookFilename('/books/02. Dune Messiah (1969).epub');
      expect(r.title).toBe('Dune Messiah');
      expect(r.publishedYear).toBe(1969);
    });

    it('handles series index AND multiple trailing parens', () => {
      const r = parseBookFilename('/books/01. Foundation (Asimov) (1951) (Retail).epub');
      expect(r.title).toBe('Foundation');
      expect(r.publishedYear).toBe(1951);
    });

    it('handles underscores and year together', () => {
      const r = parseBookFilename('/books/The_Hitchhikers_Guide (1979).epub');
      expect(r.title).toBe('The:Hitchhikers:Guide');
      expect(r.publishedYear).toBe(1979);
    });
  });

  describe('edge cases', () => {
    it('handles file with no directory component', () => {
      const r = parseBookFilename('book.epub');
      expect(r.title).toBe('book');
    });

    it('handles file whose stem is entirely a parenthetical', () => {
      // Edge case: after stripping, title may be empty — must not crash
      const r = parseBookFilename('/(2020).epub');
      // Title is empty after stripping the parenthetical
      expect(r.title).toBe('');
      expect(r.publishedYear).toBe(2020);
    });

    it('uses only the FIRST 4-digit year found', () => {
      // Two years in filename — extracts the first one
      const r = parseBookFilename('/books/Book (2000) (2020).epub');
      expect(r.publishedYear).toBe(2000);
    });
  });
});
