import { AuthorMetadataCandidate } from '@bookorbit/types';

import { pickBestAuthorNameMatch, scoreAuthorNameMatch } from './author-name-match';

function candidate(name: string): AuthorMetadataCandidate {
  return {
    provider: 'audnexus',
    providerId: name.toLowerCase().replace(/\s+/g, '-'),
    name,
  };
}

describe('author-name-match', () => {
  it('accepts exact normalized names with punctuation and diacritic differences', () => {
    const match = scoreAuthorNameMatch('Gabriel Garcia Marquez', candidate('Gabriel García Márquez'));
    expect(match.accept).toBe(true);
    expect(match.exactNormalized).toBe(true);
    expect(match.score).toBe(1);
  });

  it('accepts token order swaps when token sets are equal', () => {
    const match = scoreAuthorNameMatch('Liu Cixin', candidate('Cixin Liu'));
    expect(match.accept).toBe(true);
    expect(match.tokenSetEqual).toBe(true);
    expect(match.score).toBeGreaterThanOrEqual(0.9);
  });

  it('rejects candidates with mismatched last names', () => {
    const match = scoreAuthorNameMatch('Andrus Kivirahk', candidate('Andrus Istomin'));
    expect(match.lastTokenExact).toBe(false);
    expect(match.accept).toBe(false);
  });

  it('rejects same-last-name false positives when first names differ', () => {
    const match = scoreAuthorNameMatch('Jane Smith', candidate('John Smith'));
    expect(match.lastTokenExact).toBe(true);
    expect(match.accept).toBe(false);
  });

  it('accepts middle-name and suffix variants when first and last names align', () => {
    const withMiddle = scoreAuthorNameMatch('Stephen Edwin King', candidate('Stephen King'));
    const withSuffix = scoreAuthorNameMatch('Alexandre Dumas fils', candidate('Alexandre Dumas Fils'));
    expect(withMiddle.accept).toBe(true);
    expect(withSuffix.accept).toBe(true);
  });

  it('returns best acceptable candidate by score', () => {
    const best = pickBestAuthorNameMatch('George Orwell', [candidate('George Owell'), candidate('George Orwell'), candidate('George Oswell')]);
    expect(best?.candidate.name).toBe('George Orwell');
  });

  it('returns null when no candidate passes confidence gates', () => {
    const best = pickBestAuthorNameMatch('Charles Exbrayat', [
      candidate('Charles Lewis'),
      candidate('Charles Pellegrino'),
      candidate('Charles Chilton'),
    ]);
    expect(best).toBeNull();
  });

  it('rejects an unrelated candidate when both names have no ASCII letters', () => {
    const match = scoreAuthorNameMatch('Агата Кристи', candidate('Андрея Илиев'));
    expect(match.tokenSetEqual).toBe(false);
    expect(match.accept).toBe(false);
  });

  it('returns null when every non-ASCII candidate is unrelated', () => {
    const best = pickBestAuthorNameMatch('Агата Кристи', [candidate('Андрея Илиев'), candidate('Борис Акунин')]);
    expect(best).toBeNull();
  });

  it('rejects same-last-name false positives in a non-Latin script', () => {
    const match = scoreAuthorNameMatch('Агата Кристи', candidate('Иван Кристи'));
    expect(match.lastTokenExact).toBe(true);
    expect(match.accept).toBe(false);
  });

  it('accepts matching names in a non-Latin script', () => {
    const exact = scoreAuthorNameMatch('Агата Кристи', candidate('Агата Кристи'));
    const swapped = scoreAuthorNameMatch('Кристи Агата', candidate('Агата Кристи'));
    expect(exact.accept).toBe(true);
    expect(exact.score).toBe(1);
    expect(swapped.accept).toBe(true);
    expect(swapped.tokenSetEqual).toBe(true);
  });

  it('never treats two names without letters or digits as a token-set match', () => {
    const match = scoreAuthorNameMatch('...', candidate('?!'));
    expect(match.tokenSetEqual).toBe(false);
    expect(match.accept).toBe(false);
  });

  it('keeps script-specific combining marks, so names that differ only by one stay distinct', () => {
    const match = scoreAuthorNameMatch('कमल', candidate('कमला'));
    expect(match.exactNormalized).toBe(false);
    expect(match.accept).toBe(false);
  });
});
