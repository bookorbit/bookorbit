import {
  FOLDER_SERIES_REGEX_METADATA,
  isFolderSeriesRegexMetadata,
  REGEX_METADATA_GROUPS,
  REGEX_METADATA_LIMITS,
  resolveRegexMetadataConfig,
  SERIES_INDEX_MAX_LENGTH,
  SERIES_INDEX_PATTERN,
} from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

import { evaluateRegexMetadata } from './regex-metadata-engine';
import { prepareRegexMetadataPath } from './regex-metadata-path';

const shared = { groups: REGEX_METADATA_GROUPS, seriesIndexPattern: SERIES_INDEX_PATTERN, seriesIndexMaxLength: SERIES_INDEX_MAX_LENGTH };

function evaluate(relativePath: string) {
  const result = evaluateRegexMetadata({ config: FOLDER_SERIES_REGEX_METADATA, inputPath: prepareRegexMetadataPath(relativePath) }, shared);
  expect(result.diagnostics).toEqual([]);
  return result.matched ? result.metadata : null;
}

// Layouts taken from Komga and Kavita documentation, Kavita's scanner fixtures and folder trees
// users posted in Komga, Kavita and BookOrbit issues.
describe('folder-as-series preset', () => {
  it('runs the current rules for a library saved with an earlier version of the preset', () => {
    const saved = { preset: 'folder_series' as const, rules: [{ pattern: '^(?<series>[^/]+)/', flags: '' }] };

    expect(isFolderSeriesRegexMetadata(saved)).toBe(true);
    expect(resolveRegexMetadataConfig(saved)).toEqual(FOLDER_SERIES_REGEX_METADATA);
  });

  it('recognises unmarked preset rules and leaves custom rules alone', () => {
    const custom = { rules: [{ pattern: '^(?<series>[^/]+)/', flags: '' }] };

    expect(resolveRegexMetadataConfig({ rules: FOLDER_SERIES_REGEX_METADATA.rules })).toEqual(FOLDER_SERIES_REGEX_METADATA);
    expect(isFolderSeriesRegexMetadata(custom)).toBe(false);
    expect(resolveRegexMetadataConfig(custom)).toBe(custom);
    expect(resolveRegexMetadataConfig(null)).toBeNull();
  });

  it('stays inside the rule limits', () => {
    expect(FOLDER_SERIES_REGEX_METADATA.rules.length).toBeLessThanOrEqual(REGEX_METADATA_LIMITS.rules);
    for (const rule of FOLDER_SERIES_REGEX_METADATA.rules) expect(rule.pattern.length).toBeLessThanOrEqual(REGEX_METADATA_LIMITS.patternLength);
  });

  it.each([
    ['Marvel/Deadpool (2016)/Deadpool 001 (2016).cbz', 'Deadpool (2016)', '1'],
    ['Antarctic Press/Plush (2018)/Plush 002 (2019).cbz', 'Plush (2018)', '2'],
    ['12-Gauge Comics/Plush (2022)/Plush 1 (2022).cbz', 'Plush (2022)', '1'],
    ['Ablaze/Traveling to Mars (2022)/Traveling to Mars 010 (2024).cbz', 'Traveling to Mars (2022)', '10'],
    ['Witchblade (2018)/Witchblade 003 (2018).cbz', 'Witchblade (2018)', '3'],
    ['Spider-Man 2099 (1992)/Spider-Man 2099 012 (1992) [Digital].cbz', 'Spider-Man 2099 (1992)', '12'],
    ['2000 AD/2000 AD 2150.cbz', '2000 AD', '2150'],
    ['100 Bullets/100 Bullets 050.cbz', '100 Bullets', '50'],
    ['Saga/Saga #12.cbz', 'Saga', '12'],
    ['Batman (2016)/Batman #0.cbz', 'Batman (2016)', '0'],
    ['Superman/Superman v1 024 (09-10 1943).cbz', 'Superman', '24'],
    ['Batgirl/Batgirl Vol.2000 #57 (December, 2004).cbz', 'Batgirl', '57'],
    ['Invincible/Invincible 070.5 - The Death of Everyone.cbz', 'Invincible', '70.5'],
    ['Batman - The Long Halloween/Batman - The Long Halloween 01 (of 13) (1996).cbz', 'Batman - The Long Halloween', '1'],
    ['Space Adventures/Space_Adventures_001.cbz', 'Space Adventures', '1'],
  ])('US comics: %s', (path, series, index) => {
    expect(evaluate(path)).toEqual({ seriesName: series, seriesIndex: index });
  });

  it.each([
    ['Supergirl/Volume 05 (2005)/Supergirl (2005) Volume 05 Issue 001.cbz', 'Supergirl (2005)', '1'],
    ['Supergirl/Volume 07 (2016)/Supergirl (2016) Volume 07 Issue 012.cbz', 'Supergirl (2016)', '12'],
    ['Supergirl/Volume 06 (2011)/Supergirl (2011) 004.cbz', 'Supergirl (2011)', '4'],
  ])('runs nested under one title keep their run year: %s', (path, series, index) => {
    expect(evaluate(path)).toEqual({ seriesName: series, seriesIndex: index });
  });

  it.each([
    ['Blake et Mortimer/Blake et Mortimer T01.cbz', 'Blake et Mortimer', '1'],
    ['Astérix/Astérix - T01 - Astérix le Gaulois.cbz', 'Astérix', '1'],
    ['Les Tuniques Bleues/Les Tuniques Bleues - Tome 05 - Vol c2004.cbz', 'Les Tuniques Bleues', '5'],
    ['Dragon Ball/01 - Dragon Ball - Bulma et Son Goku.cbz', 'Dragon Ball', '1'],
  ])('European comics: %s', (path, series, index) => {
    expect(evaluate(path)).toEqual({ seriesName: series, seriesIndex: index });
  });

  it.each([
    ['One Punch Man/One Punch Man T01.cbr', 'One Punch Man', '1'],
    ['Berserk/Berserk v01.cbz', 'Berserk', '1'],
    ["VizMedia/Frieren - Beyond Journey's End/Frieren - Beyond Journey's End Vol. 2.cbz", "Frieren - Beyond Journey's End", '2'],
    ['YenPress/Spice and Wolf/Spice and Wolf Vol. 2.cbz', 'Spice and Wolf', '2'],
    ['My Dress-Up Darling/My Dress-Up Darling v02.cbz', 'My Dress-Up Darling', '2'],
    ['My Dress-Up Darling/My Dress-Up Darling ch 10.cbz', 'My Dress-Up Darling', '10'],
    ['One Piece/One Piece c1001.cbz', 'One Piece', '1001'],
    ["The Novel's Extra (Remake)/Vol.01.cbz", "The Novel's Extra (Remake)", '1'],
    ["The Novel's Extra (Remake)/The Novel's Extra Chapter 100.cbz", "The Novel's Extra (Remake)", '100'],
    ['Spice and Wolf/Spice and Wolf Vol. 3/Spice and Wolf Vol. 3 Ch. 0011.cbz', 'Spice and Wolf', '11'],
    ['Fairy Tail/volume 01/Fairy Tail - Chapter 001.cbz', 'Fairy Tail', '1'],
    ['Kaiji/01. Part 1/Volume 1.cbz', 'Kaiji', '1'],
    ['Solo Leveling/Season 2/Solo Leveling S2 Chapter 5.cbz', 'Solo Leveling', '5'],
    ['나 혼자만 레벨업/나 혼자만 레벨업 01화.cbz', '나 혼자만 레벨업', '1'],
    ['원피스/원피스 3권.cbz', '원피스', '3'],
    ['ワンピース/ワンピース 第1話.cbz', 'ワンピース', '1'],
    ['ワンピース/ワンピース 第12巻.cbz', 'ワンピース', '12'],
  ])('manga: %s', (path, series, index) => {
    expect(evaluate(path)).toEqual({ seriesName: series, seriesIndex: index });
  });

  it.each([
    ['My Dress-Up Darling/Specials/Official Anime Fanbook SP05 (2024) (Digital).cbz', 'My Dress-Up Darling'],
    ['Space Adventures/_oneshots/Pluto Adventures.cbz', 'Space Adventures'],
    ['Batman/Annuals/Batman Annual 01.cbz', 'Batman'],
    ['Saga/Extras/Saga Artbook 02.cbz', 'Saga'],
    ['Heavy Metal/1986/Heavy Metal 1986-04.cbz', 'Heavy Metal'],
    ['Watchmen/Watchmen.cbz', 'Watchmen'],
  ])('takes the series without a number when the file names none: %s', (path, series) => {
    expect(evaluate(path)).toEqual({ seriesName: series });
  });

  it.each([
    ['One Piece [Digital]/One Piece v01.cbz', 'One Piece', '1'],
    ['One Piece {Viz Media}/One Piece v02.cbz', 'One Piece', '2'],
    ['[Group] Series Name/[Group] Series Name - 01 [1080p].cbz', 'Series Name', '1'],
    ['Spider-Man 2099 (1992) [Digital]/Spider-Man 2099 001.cbz', 'Spider-Man 2099 (1992)', '1'],
    ['Series [Digital]/Series Vol. 3/Series Vol. 3 Ch. 0011.cbz', 'Series', '11'],
    ['Series/Series - 01 (v2).cbz', 'Series', '1'],
    ["The Novel's Extra (Remake)/The Novel's Extra Chapter 100.cbz", "The Novel's Extra (Remake)", '100'],
  ])('leaves release tags out of the series and number: %s', (path, series, index) => {
    expect(evaluate(path)).toEqual({ seriesName: series, seriesIndex: index });
  });

  // A badly sorted library still gets a predictable answer: the folder above each file names its series.
  it.each([
    ['Comics/Batman 001.cbz', 'Comics', '1'],
    ['Comics/Superman 001.cbz', 'Comics', '1'],
    ['Marvel/Batman/Batman 001.cbz', 'Batman', '1'],
    ['DC/Batman/Batman 001.cbz', 'Batman', '1'],
    ['Supergirl/Volume 05/Supergirl 001.cbz', 'Supergirl', '1'],
    ['Batman/Batman Annual 001.cbz', 'Batman', '1'],
    ["Manga/Rumiko Takahashi/Maison Ikkoku/Collector's Edition/Maison Ikkoku CE 01.cbz", "Collector's Edition", '1'],
  ])('names the series after the folder, however the library is sorted: %s', (path, series, index) => {
    expect(evaluate(path)).toEqual({ seriesName: series, seriesIndex: index });
  });

  it('reads a folder made of hundreds of release tags without runaway backtracking', () => {
    const tags = Array.from({ length: 300 }, () => '[a] {b} [c]').join(' ');
    expect(evaluate(`${tags}/file 01.cbz`)).toBeNull();
    expect(evaluate(`Name ${tags}/file 01.cbz`)).toEqual({ seriesName: 'Name', seriesIndex: '1' });
  });

  it('reads no number from a bare year', () => {
    expect(evaluate('Batman/Batman 2016.cbz')).toEqual({ seriesName: 'Batman' });
  });

  it('drops a folder name too long to be a series but keeps the number', () => {
    const result = evaluateRegexMetadata(
      { config: FOLDER_SERIES_REGEX_METADATA, inputPath: prepareRegexMetadataPath(`${'x'.repeat(220)}/file 01.cbz`) },
      shared,
    );
    expect(result.metadata).toEqual({ seriesIndex: '1' });
  });

  it.each(['Watchmen.cbz', '_oneshots/A oneshot.cbz', 'Specials/Annual.cbz', '1986/Heavy Metal 04.cbz'])(
    'leaves a file with no series folder to its own metadata: %s',
    (path) => {
      expect(evaluate(path)).toBeNull();
    },
  );
});
