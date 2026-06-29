import { describe, expect, it } from 'vitest';

import { contentDispositionHeader } from './content-disposition.utils';

describe('contentDispositionHeader', () => {
  it('keeps an ASCII filename fallback and adds an RFC 8187 filename', () => {
    expect(contentDispositionHeader('attachment', 'Dune - Frank Herbert.epub', 'download')).toBe(
      `attachment; filename="Dune - Frank Herbert.epub"; filename*=UTF-8''Dune%20-%20Frank%20Herbert.epub`,
    );
  });

  it('encodes non-ASCII filenames without placing raw Unicode in the quoted filename', () => {
    expect(contentDispositionHeader('attachment', 'Dune’s Café.epub', 'download')).toBe(
      `attachment; filename="Dune_s Caf_.epub"; filename*=UTF-8''Dune%E2%80%99s%20Caf%C3%A9.epub`,
    );
  });

  it('sanitizes quoted fallback filenames and percent-encodes invalid header characters in filename star', () => {
    expect(contentDispositionHeader('inline', 'bad"name\\\n.epub', 'bad"name.epub')).toBe(
      `inline; filename="bad_name__.epub"; filename*=UTF-8''bad%22name%5C%0A.epub`,
    );
  });

  it('falls back when the filename cannot be encoded', () => {
    expect(contentDispositionHeader('attachment', '', 'bad"name.epub')).toBe(`attachment; filename="bad_name.epub"`);
  });

  it('strips lone surrogates from filename star instead of throwing', () => {
    expect(contentDispositionHeader('attachment', 'ok-\ud800-\ude00.epub', 'download')).toBe(
      `attachment; filename="ok-_-_.epub"; filename*=UTF-8''ok--.epub`,
    );
  });
});
