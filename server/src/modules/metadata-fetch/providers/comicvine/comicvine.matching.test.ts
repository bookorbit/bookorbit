import { describe, expect, it } from 'vitest';

import { normalizeIssueNumber, rankVolumes } from './comicvine.matching';
import { ComicVineVolume } from './comicvine.types';

function volume(id: number, name: string, startYear: string | null, countOfIssues: number): ComicVineVolume {
  return {
    id,
    name,
    start_year: startYear,
    count_of_issues: countOfIssues,
    description: null,
    deck: null,
    image: null,
    publisher: null,
    site_detail_url: null,
  };
}

function names(volumes: ComicVineVolume[]): string[] {
  return volumes.map((v) => `${v.name} (${v.start_year})`);
}

describe('normalizeIssueNumber', () => {
  it.each([
    ['067', '67'],
    ['0067', '67'],
    ['67', '67'],
    ['  067  ', '67'],
    ['007.1', '7.1'],
    ['0.5', '0.5'],
  ])('strips the padding a filename adds: %s -> %s', (input, expected) => {
    expect(normalizeIssueNumber(input)).toBe(expected);
  });

  it.each([
    ['0', '0'],
    ['000', '0'],
  ])('keeps issue zero addressable: %s -> %s', (input, expected) => {
    expect(normalizeIssueNumber(input)).toBe(expected);
  });

  it('leaves numbers that carry no padding alone', () => {
    expect(normalizeIssueNumber('-1')).toBe('-1');
    expect(normalizeIssueNumber('1/2')).toBe('1/2');
    expect(normalizeIssueNumber('')).toBe('');
  });
});

describe('rankVolumes', () => {
  const AMAZING_SPIDER_MAN = [
    volume(90160, 'The Amazing Spider-Man Annual', '2018', 5),
    volume(1218, 'The Amazing Spider-Man', '1963', 441),
    volume(88985, 'Amazing Spider-Man: Renew Your Vows', '2016', 23),
    volume(142577, 'The Amazing Spider-Man', '2022', 93),
    volume(38536, 'Amazing Spider-Man Family', '2008', 8),
    volume(84213, 'The Amazing Spider-Man', '2018', 74),
  ];

  it('puts the runs that can hold the issue ahead of spin-offs and annuals', () => {
    const ranked = rankVolumes(AMAZING_SPIDER_MAN, 'Amazing Spider-Man', '67');

    expect(ranked.slice(0, 3).map((v) => v.id)).toEqual([142577, 84213, 1218]);
  });

  it('matches names across a leading article and punctuation', () => {
    const ranked = rankVolumes([volume(2, 'Batman: The Dark Knight', '2011', 29), volume(1, 'The Batman', '2016', 80)], 'Batman', '12');

    expect(ranked[0].id).toBe(1);
  });

  it('prefers the most recent run among equally good matches', () => {
    const ranked = rankVolumes(AMAZING_SPIDER_MAN, 'Amazing Spider-Man', '5');

    expect(names(ranked).slice(0, 3)).toEqual(['The Amazing Spider-Man (2022)', 'The Amazing Spider-Man (2018)', 'The Amazing Spider-Man (1963)']);
  });

  it('keeps an exact name ahead of a longer run with a looser name, so legacy numbering stays reachable', () => {
    const ranked = rankVolumes(
      [volume(1, 'Amazing Spider-Man Omnibus', '2020', 950), volume(2, 'Amazing Spider-Man', '2022', 93)],
      'Amazing Spider-Man',
      '900',
    );

    expect(ranked[0].id).toBe(2);
  });

  it('demotes rather than drops a run too short to hold the issue', () => {
    const ranked = rankVolumes(AMAZING_SPIDER_MAN, 'Amazing Spider-Man', '400');

    expect(ranked[0].id).toBe(1218);
    expect(ranked.map((v) => v.id)).toHaveLength(AMAZING_SPIDER_MAN.length);
    expect(ranked.map((v) => v.id)).toContain(90160);
  });

  it('treats an unknown issue count as no evidence either way', () => {
    const ranked = rankVolumes([volume(1, 'Saga', '2012', 0), volume(2, 'Saga Compendium', '2019', 100)], 'Saga', '60');

    expect(ranked[0].id).toBe(1);
  });

  it('treats a non-numeric issue number as no evidence either way', () => {
    const ranked = rankVolumes([volume(1, 'Hellboy Annual', '1997', 1), volume(2, 'Hellboy', '1994', 60)], 'Hellboy', 'Special');

    expect(ranked[0].id).toBe(2);
  });

  it('sorts a volume with no start year last among equals rather than dropping it', () => {
    const ranked = rankVolumes([volume(1, 'Akira', null, 38), volume(2, 'Akira', '1988', 38)], 'Akira', '12');

    expect(ranked.map((v) => v.id)).toEqual([2, 1]);
  });

  it('preserves the provider order for volumes it cannot tell apart', () => {
    const ranked = rankVolumes([volume(7, 'Nova', '1976', 25), volume(8, 'Nova', '1976', 25)], 'Nova', '12');

    expect(ranked.map((v) => v.id)).toEqual([7, 8]);
  });

  it('returns an empty list unchanged', () => {
    expect(rankVolumes([], 'Anything', '1')).toEqual([]);
  });
});
