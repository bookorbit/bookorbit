import {
  applyModifier,
  DEFAULT_DOWNLOAD_PATTERN,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  EXAMPLE_PATTERN_METADATA,
  MAX_PATH_SEGMENT_BYTES,
  replacePlaceholders,
  resolveDownloadFilename,
  resolveUploadPath,
  sanitizePathSegment,
  validatePattern,
} from '@bookorbit/types';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const FULL = EXAMPLE_PATTERN_METADATA;

const PARTIAL: Record<string, string> = {
  title: 'Project Hail Mary',
  authors: 'Andy Weir',
  year: '2021',
  originalFilename: 'project_hail_mary',
  extension: 'epub',
};

const MULTI_AUTHOR: Record<string, string> = {
  ...FULL,
  authors: 'Bruce Sterling, William Gibson',
};

const DECIMAL_INDEX: Record<string, string> = {
  ...FULL,
  seriesIndex: '01.5',
};

describe('sanitizePathSegment', () => {
  it('removes a large trailing run of dots and spaces in linear time', () => {
    expect(sanitizePathSegment(`book${'. '.repeat(100_000)}`)).toBe('book');
  });
});

// ── applyModifier ─────────────────────────────────────────────────────────────

describe('applyModifier', () => {
  describe('first', () => {
    it('returns the single value unchanged', () => {
      expect(applyModifier('Patrick Rothfuss', 'first', 'authors')).toBe('Patrick Rothfuss');
    });

    it('returns only the first item from a comma-separated list', () => {
      expect(applyModifier('Patrick Rothfuss, Brent Weeks', 'first', 'authors')).toBe('Patrick Rothfuss');
    });

    it('trims whitespace around the first item', () => {
      expect(applyModifier('  Andy Weir  , Someone Else', 'first', 'authors')).toBe('Andy Weir');
    });
  });

  describe('sort', () => {
    it('converts "First Last" to "Last, First"', () => {
      expect(applyModifier('Patrick Rothfuss', 'sort', 'authors')).toBe('Rothfuss, Patrick');
    });

    it('uses only the first author from a list', () => {
      expect(applyModifier('Patrick Rothfuss, Brent Weeks', 'sort', 'authors')).toBe('Rothfuss, Patrick');
    });

    it('handles a single-word name without crashing', () => {
      expect(applyModifier('Voltaire', 'sort', 'authors')).toBe('Voltaire');
    });

    it('works on non-author fields', () => {
      expect(applyModifier('The Name of the Wind', 'sort', 'title')).toBe('Wind, The Name of the');
    });
  });

  describe('initial', () => {
    it('returns first letter of title uppercased', () => {
      expect(applyModifier('the name of the wind', 'initial', 'title')).toBe('T');
    });

    it('returns first letter of last name for authors field', () => {
      expect(applyModifier('Patrick Rothfuss', 'initial', 'authors')).toBe('R');
    });

    it('uses only the first author from a list', () => {
      expect(applyModifier('Patrick Rothfuss, Brent Weeks', 'initial', 'authors')).toBe('R');
    });

    it('handles single-word author name', () => {
      expect(applyModifier('Voltaire', 'initial', 'authors')).toBe('V');
    });
  });

  describe('upper', () => {
    it('converts value to uppercase', () => {
      expect(applyModifier('The Name of the Wind', 'upper', 'title')).toBe('THE NAME OF THE WIND');
    });
  });

  describe('lower', () => {
    it('converts value to lowercase', () => {
      expect(applyModifier('The Name of the Wind', 'lower', 'title')).toBe('the name of the wind');
    });
  });

  describe('unknown modifier', () => {
    it('returns the value unchanged', () => {
      expect(applyModifier('Patrick Rothfuss', 'nonexistent', 'authors')).toBe('Patrick Rothfuss');
    });
  });

  describe('empty value', () => {
    it('returns empty string without throwing', () => {
      expect(applyModifier('', 'sort', 'authors')).toBe('');
      expect(applyModifier('', 'first', 'authors')).toBe('');
      expect(applyModifier('', 'upper', 'title')).toBe('');
    });
  });
});

// ── replacePlaceholders ───────────────────────────────────────────────────────

describe('replacePlaceholders', () => {
  describe('simple token substitution', () => {
    it('replaces a single token', () => {
      expect(replacePlaceholders('{title}', FULL)).toBe('Neuromancer');
    });

    it('replaces multiple tokens', () => {
      expect(replacePlaceholders('{authors}/{title}', FULL)).toBe('William Gibson/Neuromancer');
    });

    it('leaves literal text intact', () => {
      expect(replacePlaceholders('Books/{title}', FULL)).toBe('Books/Neuromancer');
    });

    it('replaces a missing token with an empty string', () => {
      expect(replacePlaceholders('{series}', PARTIAL)).toBe('');
    });

    it('trims leading and trailing whitespace from the result', () => {
      expect(replacePlaceholders('  {title}  ', FULL)).toBe('Neuromancer');
    });

    it('returns empty string for an empty pattern', () => {
      expect(replacePlaceholders('', FULL)).toBe('');
    });
  });

  describe('modifiers', () => {
    it('{authors:first} picks the first author', () => {
      expect(replacePlaceholders('{authors:first}', MULTI_AUTHOR)).toBe('Bruce Sterling');
    });

    it('{authors:sort} sorts the first author', () => {
      expect(replacePlaceholders('{authors:sort}', FULL)).toBe('Gibson, William');
    });

    it('{authors:initial} gives the last-name initial', () => {
      expect(replacePlaceholders('{authors:initial}', FULL)).toBe('G');
    });

    it('{title:upper} uppercases', () => {
      expect(replacePlaceholders('{title:upper}', FULL)).toBe('NEUROMANCER');
    });

    it('{title:lower} lowercases', () => {
      expect(replacePlaceholders('{title:lower}', FULL)).toBe('neuromancer');
    });

    it('{title:initial} gives the first letter of the title', () => {
      expect(replacePlaceholders('{title:initial}', FULL)).toBe('N');
    });

    it('modifier on a missing token resolves to empty string', () => {
      expect(replacePlaceholders('{series:upper}', PARTIAL)).toBe('');
    });

    it('combines modifier result with other tokens', () => {
      expect(replacePlaceholders('{authors:initial}/{authors:sort}/{title}', FULL)).toBe('G/Gibson, William/Neuromancer');
    });
  });

  describe('optional blocks <...>', () => {
    it('includes the block when all tokens are present', () => {
      expect(replacePlaceholders('<{series}/>', FULL)).toBe('Sprawl/');
    });

    it('omits the block when a token is missing', () => {
      expect(replacePlaceholders('<{series}/>', PARTIAL)).toBe('');
    });

    it('omits the block when a token is an empty string', () => {
      expect(replacePlaceholders('<{series}/>', { ...FULL, series: '' })).toBe('');
    });

    it('includes a block with multiple tokens when all are present', () => {
      // trailing space is trimmed from the overall result — test in context
      expect(replacePlaceholders('<{seriesIndex}. >{title}', FULL)).toBe('01. Neuromancer');
    });

    it('omits a multi-token block when any token is missing', () => {
      expect(replacePlaceholders('<{seriesIndex}. >', PARTIAL)).toBe('');
    });

    it('includes a year block when year is present', () => {
      // leading space is trimmed from the overall result — test in context
      expect(replacePlaceholders('{title}< ({year})>', FULL)).toBe('Neuromancer (1984)');
    });

    it('omits a year block when year is missing', () => {
      expect(replacePlaceholders('< ({year})>', { ...FULL, year: '' })).toBe('');
    });

    it('multiple optional blocks are evaluated independently', () => {
      expect(replacePlaceholders('{title}<: {subtitle}>< ({year})>', FULL)).toBe('Neuromancer: 20th Anniversary Edition (1984)');
    });

    it('omits only the absent block when some are present', () => {
      expect(replacePlaceholders('{title}<: {subtitle}>< ({year})>', PARTIAL)).toBe('Project Hail Mary (2021)');
    });
  });

  describe('optional blocks with fallback <primary|fallback>', () => {
    it('uses the primary when its token is present', () => {
      expect(replacePlaceholders('<{series}|Standalone>', FULL)).toBe('Sprawl');
    });

    it('uses the fallback when the primary token is missing', () => {
      expect(replacePlaceholders('<{series}|Standalone>', PARTIAL)).toBe('Standalone');
    });

    it('uses the fallback when the primary token is empty', () => {
      expect(replacePlaceholders('<{series}|Standalone>', { ...FULL, series: '' })).toBe('Standalone');
    });

    it('applies modifiers to the fallback', () => {
      expect(replacePlaceholders('<{series}|{authors:sort}>', PARTIAL)).toBe('Weir, Andy');
    });

    it('uses primary over fallback when primary is fully resolved', () => {
      expect(replacePlaceholders('<{series}/{seriesIndex}|{title}>', FULL)).toBe('Sprawl/01');
    });

    it('falls back to the full fallback when primary has any missing token', () => {
      expect(replacePlaceholders('<{series}/{seriesIndex}|{title}>', PARTIAL)).toBe('Project Hail Mary');
    });
  });

  describe('author fallback pattern', () => {
    it('uses the author when present', () => {
      expect(replacePlaceholders('<{authors:first}|Unknown Author>', FULL)).toBe('William Gibson');
    });

    it('falls back to "Unknown Author" when authors is missing', () => {
      expect(replacePlaceholders('<{authors:first}|Unknown Author>', { title: 'Untitled' })).toBe('Unknown Author');
    });

    it('falls back to "Unknown Author" when authors is empty string', () => {
      expect(replacePlaceholders('<{authors:first}|Unknown Author>', { ...FULL, authors: '' })).toBe('Unknown Author');
    });
  });

  describe('realistic path patterns', () => {
    it('author/series/index. title (year) -- full metadata', () => {
      expect(replacePlaceholders('{authors:first}/{series}/{seriesIndex}. {title} ({year})', FULL)).toBe(
        'William Gibson/Sprawl/01. Neuromancer (1984)',
      );
    });

    it('author/series/index. title -- no year', () => {
      expect(replacePlaceholders('{authors:first}/{series}/{seriesIndex}. {title}', FULL)).toBe('William Gibson/Sprawl/01. Neuromancer');
    });

    it('optional series folder collapses when absent', () => {
      expect(replacePlaceholders('{authors:first}/<{series}/><{seriesIndex}. >{title}', PARTIAL)).toBe('Andy Weir/Project Hail Mary');
    });

    it('optional year appended when present', () => {
      expect(replacePlaceholders('{authors:first}/<{series}/><{seriesIndex}. >{title}< ({year})>', PARTIAL)).toBe(
        'Andy Weir/Project Hail Mary (2021)',
      );
    });

    it('letter-bucketed layout', () => {
      expect(replacePlaceholders('{authors:initial}/{authors:sort}/{title}', FULL)).toBe('G/Gibson, William/Neuromancer');
    });

    it('decimal series index is preserved', () => {
      expect(replacePlaceholders('<{seriesIndex}. >{title}', DECIMAL_INDEX)).toBe('01.5. Neuromancer');
    });
  });
});

// ── resolveUploadPath ─────────────────────────────────────────────────────────

describe('KOReader device pattern', () => {
  it('routes series and standalone books into separate folders', () => {
    const pattern = '<Series/{series}/|Standalone/{authors:first} - ><{seriesIndex:fixed2} - >{title}';
    expect(resolveUploadPath(pattern, FULL, 'epub')).toBe('Series/Sprawl/1.00 - Neuromancer.epub');
    expect(resolveUploadPath(pattern, { ...FULL, series: '', seriesIndex: '' }, 'epub')).toBe('Standalone/William Gibson - Neuromancer.epub');
  });
});

describe('resolveUploadPath', () => {
  describe('extension handling', () => {
    it('appends the extension when the resolved path has none', () => {
      expect(resolveUploadPath('{authors}/{title}', FULL, 'epub')).toBe('William Gibson/Neuromancer.epub');
    });

    it('does not double-append when the pattern already ends with an extension', () => {
      expect(resolveUploadPath('{title}.epub', FULL, 'epub')).toBe('Neuromancer.epub');
    });

    it('accepts the extension with or without a leading dot', () => {
      expect(resolveUploadPath('{title}', FULL, 'epub')).toBe('Neuromancer.epub');
      expect(resolveUploadPath('{title}', FULL, '.epub')).toBe('Neuromancer.epub');
    });

    it('appends the real extension when filename stem ends with a numeric suffix', () => {
      expect(resolveUploadPath('{originalFilename}', { ...FULL, originalFilename: 'Lost in the Cañon.37466' }, 'epub')).toBe(
        'Lost in the Cañon.37466.epub',
      );
    });

    it('enforces the requested extension when pattern includes a different extension', () => {
      expect(resolveUploadPath('{title}.pdf', FULL, 'epub')).toBe('Neuromancer.pdf.epub');
    });
  });

  describe('folder-only mode (trailing slash)', () => {
    it('preserves the original filename inside the folder', () => {
      expect(resolveUploadPath('{authors}/', FULL, 'epub')).toBe('William Gibson/neuromancer.epub');
    });

    it('works with a nested folder pattern', () => {
      expect(resolveUploadPath('{authors}/{series}/', FULL, 'epub')).toBe('William Gibson/Sprawl/neuromancer.epub');
    });

    it('does not double-append when original filename already ends with extension', () => {
      expect(resolveUploadPath('{authors}/', { ...FULL, originalFilename: 'neuromancer.epub' }, 'epub')).toBe('William Gibson/neuromancer.epub');
    });
  });

  describe('originalFilename token', () => {
    it('uses the originalFilename token in path position', () => {
      expect(resolveUploadPath('{authors}/{originalFilename}', FULL, 'epub')).toBe('William Gibson/neuromancer.epub');
    });
  });

  describe('empty / null resolution', () => {
    it('returns null when the pattern resolves to an empty string', () => {
      expect(resolveUploadPath('{series}', PARTIAL, 'epub')).toBeNull();
    });

    it('returns null for an empty pattern string', () => {
      expect(resolveUploadPath('', FULL, 'epub')).toBeNull();
    });
  });

  describe('leading slash', () => {
    it('preserves a leading slash in the resolved path', () => {
      expect(resolveUploadPath('/{authors}/{title}', FULL, 'epub')).toBe('/William Gibson/Neuromancer.epub');
    });
  });
});

// ── resolveDownloadFilename ──────────────────────────────────────────────────

describe('resolveDownloadFilename', () => {
  it('resolves to original filename by default', () => {
    expect(resolveDownloadFilename(DEFAULT_DOWNLOAD_PATTERN, FULL, 'epub')).toBe('neuromancer.epub');
  });

  it('appends extension when missing', () => {
    expect(resolveDownloadFilename('{authors:first} - {title}', FULL, 'epub')).toBe('William Gibson - Neuromancer.epub');
  });

  it('uses only the last segment when folders are present', () => {
    expect(resolveDownloadFilename('{authors}/{title}', FULL, 'epub')).toBe('Neuromancer.epub');
  });

  it('supports folder-only patterns by falling back to original filename', () => {
    expect(resolveDownloadFilename('{authors}/', FULL, 'epub')).toBe('neuromancer.epub');
  });

  it('returns null when pattern resolves to an empty name', () => {
    expect(resolveDownloadFilename('{series}', PARTIAL, 'epub')).toBeNull();
  });

  it('appends extension when stem ends with a numeric suffix', () => {
    expect(resolveDownloadFilename('{originalFilename}', { ...FULL, originalFilename: 'Lost in the Cañon.37466' }, 'epub')).toBe(
      'Lost in the Cañon.37466.epub',
    );
  });

  it('enforces extension for folder patterns with numeric-suffix title', () => {
    expect(resolveDownloadFilename('{authors}/{title}', { ...FULL, title: 'Specimens.32070' }, 'epub')).toBe('Specimens.32070.epub');
  });

  it('enforces the requested extension when pattern includes a different extension', () => {
    expect(resolveDownloadFilename('{title}.pdf', FULL, 'epub')).toBe('Neuromancer.pdf.epub');
  });

  it('does not double-append when resolved stem already ends with extension', () => {
    expect(resolveDownloadFilename('{originalFilename}', { ...FULL, originalFilename: 'neuromancer.epub' }, 'epub')).toBe('neuromancer.epub');
  });
});

describe('cross-platform sanitization option', () => {
  it('keeps legacy output unchanged when sanitization is disabled', () => {
    expect(resolveUploadPath('{authors}/{title}', { ...FULL, authors: 'CON', title: 'Book: Volume 1?' }, 'epub')).toBe('CON/Book: Volume 1?.epub');
  });

  it('sanitizes invalid characters and reserved names in upload path tokens when enabled', () => {
    expect(
      resolveUploadPath('{authors}/{title}', { ...FULL, authors: 'CON', title: 'Book: Volume 1?' }, 'epub', { sanitizeForCrossPlatform: true }),
    ).toBe('CON_/Book_ Volume 1_.epub');
  });

  it('supports dash replacement character when sanitization is enabled', () => {
    expect(
      resolveDownloadFilename('{title}', { ...FULL, title: 'Book: Volume 1?' }, 'epub', {
        sanitizeForCrossPlatform: true,
        replacementCharacter: '-',
      }),
    ).toBe('Book- Volume 1-.epub');
  });

  it('trims unsafe trailing dot/space and guards reserved names with extensions', () => {
    expect(resolveDownloadFilename('{title}', { ...FULL, title: 'NUL.txt ' }, 'epub', { sanitizeForCrossPlatform: true })).toBe('NUL.txt_.epub');
  });

  it('replaces double-quote characters in token values', () => {
    expect(resolveUploadPath('{title}', { ...FULL, title: 'He said "hello"' }, 'epub', { sanitizeForCrossPlatform: true })).toBe(
      'He said _hello_.epub',
    );
  });

  it('sanitizes disabled preserves double-quote in output', () => {
    expect(resolveUploadPath('{title}', { ...FULL, title: '"Quotes"' }, 'epub')).toBe('"Quotes".epub');
  });

  it('sanitizes disabled preserves colon in output', () => {
    expect(resolveUploadPath('{title}', { ...FULL, title: 'Bad Love: A Novel' }, 'epub')).toBe('Bad Love: A Novel.epub');
  });

  it('replaces all Windows-reserved chars in a single token value', () => {
    const messy = 'A<B>C:D"E/F\\G|H?I*J';
    const result = resolveDownloadFilename('{title}', { ...FULL, title: messy }, 'epub', { sanitizeForCrossPlatform: true });
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('replaces control characters (U+0001) in token values', () => {
    const result = resolveDownloadFilename('{title}', { ...FULL, title: 'Evil\u0001Title' }, 'epub', { sanitizeForCrossPlatform: true });
    expect(result).toBe('Evil_Title.epub');
  });

  it('uses replacement char when token value consists entirely of dots and spaces', () => {
    const result = resolveDownloadFilename('{title}', { ...FULL, title: '.' }, 'epub', { sanitizeForCrossPlatform: true });
    expect(result).toBe('_.epub');
  });

  it('strips trailing dots from token values', () => {
    const result = resolveDownloadFilename('{title}', { ...FULL, title: 'Book Title...' }, 'epub', { sanitizeForCrossPlatform: true });
    expect(result).toBe('Book Title.epub');
  });

  it('replaces forward slash within a token value (not treated as path separator)', () => {
    const result = resolveUploadPath('{title}', { ...FULL, title: '24/7 Life' }, 'epub', { sanitizeForCrossPlatform: true });
    expect(result).toBe('24_7 Life.epub');
  });

  it('sanitizes originalFilename token when used in a folder-only pattern', () => {
    const result = resolveUploadPath('{authors}/', { ...FULL, authors: 'Author A', originalFilename: 'bad:file' }, 'epub', {
      sanitizeForCrossPlatform: true,
    });
    expect(result).not.toContain(':');
    expect(result).toContain('bad_file.epub');
  });

  it('extension token is unaffected by sanitization (no special chars in normal formats)', () => {
    const result = resolveUploadPath('{title}.{extension}', { ...FULL, title: 'Normal Title', extension: 'epub' }, 'epub', {
      sanitizeForCrossPlatform: true,
    });
    expect(result).toBe('Normal Title.epub');
  });

  it('multi-segment path preserves pattern slashes while sanitizing token values', () => {
    const result = resolveUploadPath('{authors}/{title}', { ...FULL, authors: 'Author: A', title: 'Book "B"' }, 'epub', {
      sanitizeForCrossPlatform: true,
    });
    expect(result).toContain('/');
    expect(result).not.toMatch(/[:"]/);
  });

  it('keeps empty values empty so optional blocks are omitted during sanitization', () => {
    const pattern =
      '<{authors:first}|Unknown Author>/<{series}/><{seriesIndex:fixed2} - ><{title}|{originalFilename}>< ({year})>/<{seriesIndex:fixed2} - ><{title}|{originalFilename}>< ({year})> - <{authors:first}|Unknown Author>';
    const values = { ...FULL, series: '', seriesIndex: '' };

    expect(resolveUploadPath(pattern, values, 'epub', { sanitizeForCrossPlatform: true })).toBe(
      'William Gibson/Neuromancer (1984)/Neuromancer (1984) - William Gibson.epub',
    );
  });

  it('omits an empty optional series segment instead of replacing it with an underscore', () => {
    expect(resolveUploadPath('<{series}/>{title}', { ...FULL, series: '' }, 'epub', { sanitizeForCrossPlatform: true })).toBe('Neuromancer.epub');
  });

  it('omits an empty optional series index prefix instead of replacing it with an underscore', () => {
    expect(resolveUploadPath('<{seriesIndex:fixed2} - >{title}', { ...FULL, seriesIndex: '' }, 'epub', { sanitizeForCrossPlatform: true })).toBe(
      'Neuromancer.epub',
    );
  });
});

describe('path segment byte limits', () => {
  function expectSegmentsWithinLimit(path: string) {
    for (const segment of path.split('/').filter(Boolean)) {
      expect(Buffer.byteLength(segment, 'utf8')).toBeLessThanOrEqual(MAX_PATH_SEGMENT_BYTES);
    }
  }

  it('truncates long generated upload path segments and preserves the file extension', () => {
    const result = resolveUploadPath('{authors}/{title}', { ...FULL, authors: 'A'.repeat(300), title: 'B'.repeat(300) }, 'epub');

    expect(result).not.toBeNull();
    expectSegmentsWithinLimit(result!);
    expect(result!.split('/')).toHaveLength(2);
    expect(result!.endsWith('.epub')).toBe(true);
    expect(result).toContain('~');
  });

  it('truncates download filenames before the filesystem segment limit', () => {
    const result = resolveDownloadFilename('{title}', { ...FULL, title: 'Long Title '.repeat(40) }, 'epub');

    expect(result).not.toBeNull();
    expect(Buffer.byteLength(result!, 'utf8')).toBeLessThanOrEqual(MAX_PATH_SEGMENT_BYTES);
    expect(result!.endsWith('.epub')).toBe(true);
    expect(result).toContain('~');
  });

  it('does not split multibyte characters while truncating', () => {
    const result = resolveDownloadFilename('{title}', { ...FULL, title: 'é'.repeat(200) }, 'epub');

    expect(result).not.toBeNull();
    expect(Buffer.byteLength(result!, 'utf8')).toBeLessThanOrEqual(MAX_PATH_SEGMENT_BYTES);
    expect(result!.endsWith('.epub')).toBe(true);

    const [stem] = result!.split('~');
    expect([...stem].every((char) => char === 'é')).toBe(true);
  });

  it('uses a deterministic suffix so distinct long values do not collapse to the same filename', () => {
    const prefix = 'Same prefix '.repeat(30);
    const first = resolveDownloadFilename('{title}', { ...FULL, title: `${prefix}one` }, 'epub');
    const second = resolveDownloadFilename('{title}', { ...FULL, title: `${prefix}two` }, 'epub');

    expect(first).not.toBe(second);
    expect(Buffer.byteLength(first!, 'utf8')).toBeLessThanOrEqual(MAX_PATH_SEGMENT_BYTES);
    expect(Buffer.byteLength(second!, 'utf8')).toBeLessThanOrEqual(MAX_PATH_SEGMENT_BYTES);
  });
});

// ── validatePattern ───────────────────────────────────────────────────────────

describe('validatePattern', () => {
  it('accepts a simple token pattern', () => {
    expect(validatePattern('{title}')).toBe(true);
  });

  it('accepts a complex realistic pattern', () => {
    expect(validatePattern(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE)).toBe(true);
  });

  it('accepts path separators and common punctuation', () => {
    expect(validatePattern('{authors}/{series} - {title} ({year})')).toBe(true);
  });

  it('accepts the pipe character used in fallbacks', () => {
    expect(validatePattern('<{series}|Standalone>')).toBe(true);
  });

  it('rejects a null byte', () => {
    expect(validatePattern('{title}\0bad')).toBe(false);
  });

  it('rejects a backslash', () => {
    expect(validatePattern('{authors}\\{title}')).toBe(false);
  });

  it('rejects an asterisk', () => {
    expect(validatePattern('{title}*')).toBe(false);
  });

  it('rejects a question mark', () => {
    expect(validatePattern('{title}?')).toBe(false);
  });

  it('accepts an empty string', () => {
    expect(validatePattern('')).toBe(true);
  });
});

// ── DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE integration ─────────────────────────

describe('DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE', () => {
  const P = DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE;

  it('full metadata: author / series / index. title (year)', () => {
    expect(resolveUploadPath(P, FULL, 'epub')).toBe('William Gibson/Sprawl/01. Neuromancer (1984).epub');
  });

  it('no series: author / title (year)', () => {
    expect(resolveUploadPath(P, PARTIAL, 'epub')).toBe('Andy Weir/Project Hail Mary (2021).epub');
  });

  it('no year: author / series / index. title', () => {
    expect(resolveUploadPath(P, { ...FULL, year: '' }, 'epub')).toBe('William Gibson/Sprawl/01. Neuromancer.epub');
  });

  it('no series and no year: author / title', () => {
    expect(resolveUploadPath(P, { ...PARTIAL, year: '' }, 'epub')).toBe('Andy Weir/Project Hail Mary.epub');
  });

  it('no author: falls back to Unknown Author folder', () => {
    expect(resolveUploadPath(P, { ...PARTIAL, authors: '' }, 'epub')).toBe('Unknown Author/Project Hail Mary (2021).epub');
  });

  it('no author and no metadata: Unknown Author / title', () => {
    expect(resolveUploadPath(P, { title: 'Untitled', originalFilename: 'untitled', extension: 'epub' }, 'epub')).toBe('Unknown Author/Untitled.epub');
  });

  it('no title: falls back to original filename', () => {
    expect(resolveUploadPath(P, { authors: '', title: '', originalFilename: 'original-stem', extension: 'epub' }, 'epub')).toBe(
      'Unknown Author/original-stem.epub',
    );
  });

  it('multiple authors: uses only the first', () => {
    expect(resolveUploadPath(P, MULTI_AUTHOR, 'epub')).toBe('Bruce Sterling/Sprawl/01. Neuromancer (1984).epub');
  });

  it('decimal series index is preserved', () => {
    expect(resolveUploadPath(P, DECIMAL_INDEX, 'epub')).toBe('William Gibson/Sprawl/01.5. Neuromancer (1984).epub');
  });

  it('series present but no index: series folder without index prefix', () => {
    expect(resolveUploadPath(P, { ...FULL, seriesIndex: '' }, 'epub')).toBe('William Gibson/Sprawl/Neuromancer (1984).epub');
  });

  it('different file extension is appended correctly', () => {
    expect(resolveUploadPath(P, PARTIAL, 'pdf')).toBe('Andy Weir/Project Hail Mary (2021).pdf');
  });

  it('passes validatePattern', () => {
    expect(validatePattern(P)).toBe(true);
  });
});

// ── DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER integration ───────────────────────

describe('DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER', () => {
  const P = DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER;

  it('full metadata: author / series / index. title (year) / index. title (year)', () => {
    expect(resolveUploadPath(P, FULL, 'epub')).toBe('William Gibson/Sprawl/01. Neuromancer (1984)/01. Neuromancer (1984).epub');
  });

  it('no title: falls back to original filename in folder and file segments', () => {
    expect(resolveUploadPath(P, { authors: '', title: '', originalFilename: 'original-stem', extension: 'epub' }, 'epub')).toBe(
      'Unknown Author/original-stem/original-stem.epub',
    );
  });

  it('passes validatePattern', () => {
    expect(validatePattern(P)).toBe(true);
  });
});
