import { deriveFolderSeries, indexSeriesFolder, parseComicFilename, seriesDirectoryFor, seriesNameFromDirectory } from './folder-series';

// ── VOLUME MARKERS ────────────────────────────────────────────────────────────

describe('parseComicFilename: volumes', () => {
  it.each([
    ['Blake et Mortimer T01', 'Blake et Mortimer', '1'],
    ['Blake et Mortimer - Tome 12', 'Blake et Mortimer', '12'],
    ['Largo Winch T.3', 'Largo Winch', '3'],
    ['One Piece v01', 'One Piece', '1'],
    ['One Piece vol. 1', 'One Piece', '1'],
    ['One Piece Vol.1', 'One Piece', '1'],
    ['One Piece Volume 105', 'One Piece', '105'],
    ['Saga #3', 'Saga', '3'],
    ['ワンピース 第1巻', null, '1'],
    ['海贼王 第3卷', null, '3'],
    ['나 혼자만 레벨업 1권', null, '1'],
    ['ワンピース １巻', null, '1'],
    ['Largo Winch 03', 'Largo Winch', '3'],
    ['Largo Winch - 03', 'Largo Winch', '3'],
    ['03', 'Largo Winch', '3'],
    ['One Piece v01-03', 'One Piece', '1'],
    ['Asterix T10.5', 'Asterix', '10.5'],
    ['Tome 1', null, '1'],
  ])('%s -> volume %s', (stem, series, volume) => {
    expect(parseComicFilename(stem, series)).toEqual({ volume, chapter: null });
  });
});

// ── CHAPTER MARKERS ───────────────────────────────────────────────────────────

describe('parseComicFilename: chapters', () => {
  it.each([
    ['Solo Leveling c01', 'Solo Leveling', '1'],
    ['Solo Leveling ch01', 'Solo Leveling', '1'],
    ['Solo Leveling Ch.12', 'Solo Leveling', '12'],
    ['Solo Leveling chapter 1', 'Solo Leveling', '1'],
    ['나 혼자만 레벨업 01화', null, '1'],
    ['나 혼자만 레벨업 01회', null, '1'],
    ['ワンピース 第1話', null, '1'],
    ['海贼王 第1话', null, '1'],
    ['斗破苍穹 第12章', null, '12'],
    ['Solo Leveling c10.5', 'Solo Leveling', '10.5'],
    ['Solo Leveling c001-010', 'Solo Leveling', '1'],
  ])('%s -> chapter %s', (stem, series, chapter) => {
    expect(parseComicFilename(stem, series)).toEqual({ volume: null, chapter });
  });

  it.each([
    ['One Piece v01 c001', '1', '1'],
    ['One Piece Vol.03 Ch.021', '3', '21'],
    ['One Piece (v01) c001', '1', '1'],
  ])('reads both markers in %s', (stem, volume, chapter) => {
    expect(parseComicFilename(stem, 'One Piece')).toEqual({ volume, chapter });
  });
});

// ── FALSE POSITIVES ───────────────────────────────────────────────────────────

describe('parseComicFilename: ignored numbers', () => {
  it.each([
    ['Batman (2016) #12', 'Batman', '12', 'year in parentheses'],
    ['Akira [Digital] [1080p] v02', 'Akira', '2', 'bracket tags'],
    ['Akira 1080p v02', 'Akira', '2', 'bare resolution'],
    ['Akira 1920x1080 v02', 'Akira', '2', 'WxH resolution'],
    ['Area 51 T03', 'Area 51', '3', 'number in the series title'],
    ['Spider-Man 2099 001', 'Spider-Man 2099', '1', 'title number stripped with the folder name'],
    ['20th Century Boys v05', '20th Century Boys', '5', 'leading title number'],
    ['86 Eighty-Six v01', '86', '1', 'series named by a number'],
    ['Gantz Vol 01 (of 37)', 'Gantz', '1', '"of N" suffix'],
    ['Chateau dans le ciel (Le) - Anime comics 2', 'Chateau dans le ciel (Le)', '2', 'parentheses inside the series name'],
  ])('%s -> volume %s (%s)', (stem, series, volume) => {
    expect(parseComicFilename(stem, series)).toEqual({ volume, chapter: null });
  });

  it.each([
    ['Batman 1989', 'Batman', 'bare year'],
    ['Area 51', 'Area 51', 'title number only'],
    ['Watchmen c2c', 'Watchmen', 'c2c scene tag'],
    ['Watchmen (c2c) (Digital)', 'Watchmen', 'c2c in parentheses'],
    ['Tintin et le Temple du Soleil', 'Tintin', 'no number at all'],
    ['Victor v2x', 'Victor', 'marker glued to letters'],
    ['Letter from Tokyo', null, 'word starting with a marker letter'],
    ['Vinland Saga', null, 'word starting with v'],
  ])('%s -> no number (%s)', (stem, series) => {
    expect(parseComicFilename(stem, series)).toEqual({ volume: null, chapter: null });
  });
});

// ── LEADING INDEX (Komga-style "NN - Series - Title") ─────────────────────────

describe('parseComicFilename: leading index', () => {
  it.each([
    ['01 - Lucky Luke Les Aventures De - Belle Province La', 'Lucky Luke Les Aventures De', '1'],
    ['113 - Bob Et Bobette 3e Série Rouge - Gladiateur-Mystère Le', 'Bob Et Bobette 3e Série Rouge', '113'],
    ['00 - IR - Dossiers Max Les', 'IR', '0'],
    ['07. Jeannette Et Jojo', 'Jeannette Et Jojo', '7'],
    ['04_Ivor_Comme Un Faucon', 'Ivor', '4'],
    ['01 - Wood Les - Tome 3', 'Wood Les', '1'],
  ])('%s -> volume %s', (stem, series, volume) => {
    expect(parseComicFilename(stem, series)).toEqual({ volume, chapter: null });
  });

  it('lets the leading index hide chapter-looking words of the title', () => {
    expect(parseComicFilename('01 - Aventuriers Les - Cycle Des Krygonites C1 Le', 'Aventuriers Les')).toEqual({ volume: '1', chapter: null });
  });

  it('does not read a leading year as an index', () => {
    expect(parseComicFilename('2019 - AUT Walthery - Une Vie En Dessins', 'AUT Walthery')).toEqual({ volume: null, chapter: null });
  });
});

describe('parseComicFilename: BD labels that are not chapters', () => {
  it.each([
    ['Styx - Styx-Tc2012-2012TONER3692pxImprimeur Vol c2012', 'Styx', 'copyright year after Vol'],
    ['Durango.-.T09.(c2008).-.L Or De Duncan', 'Durango', 'copyright year in parentheses'],
    ['Asterix Hors Serie - Asterix Et Les Vikings Vol C06', 'Asterix Hors Serie', 'collection code after Vol'],
  ])('%s has no chapter (%s)', (stem, series) => {
    expect(parseComicFilename(stem, series).chapter).toBeNull();
  });

  it('keeps T09 when a copyright year sits next to it', () => {
    expect(parseComicFilename('Durango.-.T09.(c2008).-.L Or De Duncan', 'Durango').volume).toBe('9');
  });

  it('ignores letters and digits that belong to the series name after a leading index', () => {
    expect(parseComicFilename('01 - XHG-C3 - Vaisseau Rebelle Le', 'XHG-C3')).toEqual({ volume: '1', chapter: null });
    expect(parseComicFilename('XHG-C3 - Vaisseau Rebelle Le', 'XHG-C3')).toEqual({ volume: null, chapter: null });
  });
});

// ── FOLDER DECISION ───────────────────────────────────────────────────────────

describe('indexSeriesFolder', () => {
  it('indexes the whole folder by chapter once one file has a chapter marker', () => {
    const { mode, indices } = indexSeriesFolder(['One Piece v01 c001', 'One Piece v01 c002', 'One Piece c003'], 'One Piece');
    expect(mode).toBe('chapter');
    expect([...indices.values()]).toEqual(['1', '2', '3']);
  });

  it('gives a volume-only file no index in a chapter folder', () => {
    const { mode, indices } = indexSeriesFolder(['Solo Leveling v01', 'Solo Leveling c10'], 'Solo Leveling');
    expect(mode).toBe('chapter');
    expect(indices.get('Solo Leveling v01')).toBeNull();
    expect(indices.get('Solo Leveling c10')).toBe('10');
  });

  it('gives an unnumbered file no index in a volume folder rather than a colliding position', () => {
    const { mode, indices } = indexSeriesFolder(['Largo Winch T01', 'Largo Winch T02', 'Largo Winch - Hors serie'], 'Largo Winch');
    expect(mode).toBe('volume');
    expect(indices.get('Largo Winch T02')).toBe('2');
    expect(indices.get('Largo Winch - Hors serie')).toBeNull();
  });

  it('falls back to natural sort position when nothing in the folder is numbered', () => {
    const { mode, indices } = indexSeriesFolder(['Tintin au Tibet', 'Tintin au Congo', 'Tintin en Amerique'], 'Tintin');
    expect(mode).toBe('position');
    expect(indices.get('Tintin au Congo')).toBe('1');
    expect(indices.get('Tintin au Tibet')).toBe('2');
    expect(indices.get('Tintin en Amerique')).toBe('3');
  });
});

// ── SERIES NAME AND DIRECTORY ─────────────────────────────────────────────────

describe('seriesNameFromDirectory', () => {
  it.each([
    ['Blake et Mortimer', 'Blake et Mortimer'],
    ['One_Piece', 'One Piece'],
    ['Akira [Digital] {Kodansha}', 'Akira'],
    ['Spider-Man 2099 (1992)', 'Spider-Man 2099'],
    ['Chateau dans le ciel (Le)', 'Chateau dans le ciel (Le)'],
    ['[Scans]', null],
  ])('%s -> %s', (directory, name) => {
    expect(seriesNameFromDirectory(directory)).toBe(name);
  });
});

describe('seriesDirectoryFor', () => {
  it('has no series for files directly under the library root', () => {
    expect(seriesDirectoryFor('/library', '/library')).toBeNull();
  });

  it('uses the containing directory', () => {
    expect(seriesDirectoryFor('/library/BD/Largo Winch', '/library')).toBe('/library/BD/Largo Winch');
  });

  it('skips a volume directory to reach the series', () => {
    expect(seriesDirectoryFor('/library/One Piece/Vol 01', '/library')).toBe('/library/One Piece');
    expect(seriesDirectoryFor('/library/One Piece/Tome 3', '/library')).toBe('/library/One Piece');
  });

  it('keeps a volume-named directory that sits directly under the root', () => {
    expect(seriesDirectoryFor('/library/Vol 01', '/library')).toBe('/library/Vol 01');
  });
});

describe('deriveFolderSeries', () => {
  it('maps every file of a series folder to the folder name and its index', () => {
    const result = deriveFolderSeries(
      '/library/Blake et Mortimer',
      ['/library/Blake et Mortimer/Blake et Mortimer T02.cbz', '/library/Blake et Mortimer/Blake et Mortimer T01.cbz'],
      '/library',
    );
    expect(result.get('/library/Blake et Mortimer/Blake et Mortimer T01.cbz')).toEqual({ name: 'Blake et Mortimer', index: '1' });
    expect(result.get('/library/Blake et Mortimer/Blake et Mortimer T02.cbz')).toEqual({ name: 'Blake et Mortimer', index: '2' });
  });

  it('names chapters in a volume directory after the series above it', () => {
    const result = deriveFolderSeries('/library/One Piece/Vol 01', ['/library/One Piece/Vol 01/c001.cbz'], '/library');
    expect(result.get('/library/One Piece/Vol 01/c001.cbz')).toEqual({ name: 'One Piece', index: '1' });
  });

  it('derives nothing for files at the library root', () => {
    expect(deriveFolderSeries('/library', ['/library/loose.cbz'], '/library').size).toBe(0);
  });
});
