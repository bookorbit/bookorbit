import { classifyFile, isPrimaryFormat, isAudioFormat, AUDIO_FORMATS, DEFAULT_FORMAT_PRIORITY, FILE_ROLES } from './classify';

// ── PRIMARY FORMATS ───────────────────────────────────────────────────────────

describe('classifyFile — primary formats', () => {
  it.each(['epub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2'])('classifies .%s as primary', (ext) => {
    const result = classifyFile(`/books/Author/Book/book.${ext}`);
    expect(result).toEqual({ format: ext, role: 'content' });
  });

  it('classifies extensions case-insensitively', () => {
    expect(classifyFile('/books/Book.EPUB')).toEqual({ format: 'epub', role: 'content' });
    expect(classifyFile('/books/Book.PDF')).toEqual({ format: 'pdf', role: 'content' });
    expect(classifyFile('/books/Book.CBZ')).toEqual({ format: 'cbz', role: 'content' });
  });

  it('format matches the lowercased extension, not the original', () => {
    const { format } = classifyFile('/books/Book.EPUB');
    expect(format).toBe('epub');
  });
});

// ── COVER FILES ───────────────────────────────────────────────────────────────

describe('classifyFile — cover images', () => {
  it.each(['cover', 'folder', 'thumbnail', 'artwork', 'front'])('classifies %s.jpg as cover', (stem) => {
    const result = classifyFile(`/books/Book/${stem}.jpg`);
    expect(result.role).toBe('cover');
  });

  it.each(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])('classifies cover.%s as cover', (ext) => {
    const result = classifyFile(`/books/Book/cover.${ext}`);
    expect(result.role).toBe('cover');
    expect(result.format).toBe(ext);
  });

  it('classifies image with unrecognised basename as supplementary', () => {
    const result = classifyFile('/books/Book/myimage.jpg');
    expect(result.role).toBe('supplement');
    expect(result.format).toBe('jpg');
  });

  it('cover basename check is case-insensitive', () => {
    expect(classifyFile('/books/Book/Cover.jpg').role).toBe('cover');
    expect(classifyFile('/books/Book/COVER.PNG').role).toBe('cover');
    expect(classifyFile('/books/Book/Thumbnail.WEBP').role).toBe('cover');
  });
});

// ── METADATA FILES ────────────────────────────────────────────────────────────

describe('classifyFile — metadata files', () => {
  it('classifies .opf as metadata', () => {
    expect(classifyFile('/books/Book/book.opf')).toEqual({ format: 'opf', role: 'metadata' });
  });

  it('classifies .nfo as metadata', () => {
    expect(classifyFile('/books/Book/book.nfo')).toEqual({ format: 'nfo', role: 'metadata' });
  });
});

// ── SUPPLEMENTARY ─────────────────────────────────────────────────────────────

describe('classifyFile — supplementary', () => {
  it('classifies unknown extensions as supplementary', () => {
    expect(classifyFile('/books/Book/readme.txt').role).toBe('supplement');
    expect(classifyFile('/books/Book/notes.md').role).toBe('supplement');
    expect(classifyFile('/books/Book/data.xml').role).toBe('supplement');
  });

  it('returns null format for files with no extension', () => {
    const result = classifyFile('/books/Book/RELEASE');
    expect(result.role).toBe('supplement');
    expect(result.format).toBeNull();
  });

  it('handles files with dots in the name but unknown final extension', () => {
    const result = classifyFile('/books/Book/my.archive.rar');
    expect(result.role).toBe('supplement');
    expect(result.format).toBe('rar');
  });
});

// ── isPrimaryFormat ───────────────────────────────────────────────────────────

describe('isPrimaryFormat', () => {
  it('returns true for all primary format extensions', () => {
    for (const ext of DEFAULT_FORMAT_PRIORITY) {
      expect(isPrimaryFormat(`/path/file.${ext}`)).toBe(true);
    }
  });

  it('returns false for non-primary files', () => {
    expect(isPrimaryFormat('/path/cover.jpg')).toBe(false);
    expect(isPrimaryFormat('/path/book.opf')).toBe(false);
    expect(isPrimaryFormat('/path/readme.txt')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isPrimaryFormat('/path/book.EPUB')).toBe(true);
    expect(isPrimaryFormat('/path/book.PDF')).toBe(true);
  });
});

// ── DEFAULT_FORMAT_PRIORITY ───────────────────────────────────────────────────

describe('DEFAULT_FORMAT_PRIORITY', () => {
  it('epub is first (highest priority)', () => {
    expect(DEFAULT_FORMAT_PRIORITY[0]).toBe('epub');
  });

  it('every format in DEFAULT_FORMAT_PRIORITY is a primary format', () => {
    for (const fmt of DEFAULT_FORMAT_PRIORITY) {
      expect(isPrimaryFormat(`/path/file.${fmt}`)).toBe(true);
    }
  });
});

// ── AUDIO FORMATS ─────────────────────────────────────────────────────────────

describe('classifyFile — audio formats', () => {
  it.each([...AUDIO_FORMATS])('classifies .%s as primary', (ext) => {
    const result = classifyFile(`/books/Author/Book/book.${ext}`);
    expect(result).toEqual({ format: ext, role: 'content' });
  });

  it('audio formats are case-insensitive', () => {
    expect(classifyFile('/books/Book/book.M4B')).toEqual({ format: 'm4b', role: 'content' });
    expect(classifyFile('/books/Book/book.MP3')).toEqual({ format: 'mp3', role: 'content' });
  });
});

describe('isAudioFormat', () => {
  it('returns true for all audio formats', () => {
    for (const fmt of AUDIO_FORMATS) {
      expect(isAudioFormat(fmt)).toBe(true);
    }
  });

  it('returns false for non-audio formats', () => {
    expect(isAudioFormat('epub')).toBe(false);
    expect(isAudioFormat('pdf')).toBe(false);
    expect(isAudioFormat('jpg')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isAudioFormat('M4B')).toBe(true);
    expect(isAudioFormat('MP3')).toBe(true);
  });
});

describe('DEFAULT_FORMAT_PRIORITY — audio ordering', () => {
  it('epub appears before all audio formats (epub wins in mixed book)', () => {
    const epubIdx = DEFAULT_FORMAT_PRIORITY.indexOf('epub');
    for (const fmt of AUDIO_FORMATS) {
      const audioIdx = DEFAULT_FORMAT_PRIORITY.indexOf(fmt);
      expect(epubIdx).toBeLessThan(audioIdx);
    }
  });

  it('all audio formats are present in DEFAULT_FORMAT_PRIORITY', () => {
    for (const fmt of AUDIO_FORMATS) {
      expect(DEFAULT_FORMAT_PRIORITY).toContain(fmt);
    }
  });
});

// ── FILE_ROLES contract ───────────────────────────────────────────────────────

describe('FILE_ROLES contract', () => {
  it('defines exactly the four expected roles', () => {
    expect([...FILE_ROLES].sort()).toEqual(['content', 'cover', 'metadata', 'supplement']);
  });

  const probes: Array<[string, string]> = [
    ['primary', '/books/Book/book.epub'],
    ['audio primary', '/books/Book/book.m4b'],
    ['metadata opf', '/books/Book/metadata.opf'],
    ['metadata nfo', '/books/Book/info.nfo'],
    ['named cover', '/books/Book/cover.jpg'],
    ['unnamed image', '/books/Book/photo.jpg'],
    ['unknown extension', '/books/Book/readme.txt'],
    ['no extension', '/books/Book/RELEASE'],
  ];

  it.each(probes)('role returned for %s is a valid FILE_ROLES member', (_label, path) => {
    const { role } = classifyFile(path);
    expect(FILE_ROLES as readonly string[]).toContain(role);
  });
});
