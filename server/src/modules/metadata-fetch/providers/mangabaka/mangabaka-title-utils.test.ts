import { describe, expect, it } from 'vitest';

import { detectLanguageHint, extractChapterNumber, extractVolumeNumber, stripVolumeMarker } from './mangabaka-title-utils';

describe('stripVolumeMarker', () => {
  describe('strips trailing volume markers', () => {
    const cases: Array<[string, string]> = [
      ['Death Note T09', 'Death Note'],
      ['Death Note Tome 09', 'Death Note'],
      ['Death Note tome 9', 'Death Note'],
      ['Death Note vol09', 'Death Note'],
      ['Death Note v09', 'Death Note'],
      ['Death Note volume 09', 'Death Note'],
      ['Death Note issue 09', 'Death Note'],
      ['Death Note Vol. 9', 'Death Note'],
      ['Death Note T 9', 'Death Note'],
      ['Death Note ch12', 'Death Note'],
      ['Death Note chapter 12', 'Death Note'],
      ['death note v09', 'death note'],
      ['Death Note T09 ', 'Death Note'],
      ['Berserk Vol.42', 'Berserk'],
      ['One Piece v100', 'One Piece'],
      ['Fairy Tail 13', 'Fairy Tail'],
      ['Fairy Tail T13', 'Fairy Tail'],
      ['Fairy Tail v13', 'Fairy Tail'],
      ['Naruto Vol.72 2014', 'Naruto'],
      ['Naruto 1-5', 'Naruto'],
      ['Berserk Vol. 42.5', 'Berserk'],
      ['Naruto 2014', 'Naruto'],
      ['Berserk 1989', 'Berserk'],
    ];

    for (const [input, expected] of cases) {
      it(`strips "${input}" -> "${expected}"`, () => {
        expect(stripVolumeMarker(input)).toBe(expected);
      });
    }
  });

  describe('strips bracketed metadata blocks', () => {
    const cases: Array<[string, string]> = [
      ['Fairy Tail 13 [Hiro Mashima] [Manga FR] [Digital-1246]', 'Fairy Tail'],
      ['Naruto [Manga] [Digital]', 'Naruto'],
      ['Berserk Vol.42 [Kentaro Miura] [Dark Horse]', 'Berserk'],
      ['One Piece [Eiichiro Oda]', 'One Piece'],
      ['Title [Tag1] [Tag2] [Tag3]', 'Title'],
      ['Title [outer [inner]]', 'Title'],
      ['Fairy Tail 13 (Hiro Mashima) (Manga FR)', 'Fairy Tail'],
      ['Naruto (Digital)', 'Naruto'],
      ['Title (Tag1) (Tag2)', 'Title'],
    ];

    for (const [input, expected] of cases) {
      it(`strips "${input}" -> "${expected}"`, () => {
        expect(stripVolumeMarker(input)).toBe(expected);
      });
    }
  });

  describe('preserves titles without trailing volume markers', () => {
    const cases: Array<string | [string, string]> = [
      'Death Note',
      'V for Vendetta',
      'Vampire Knight',
      'The Walking Dead',
      'Solo Leveling',
      'A Certain Magical Index',
      'Vinland Saga',
      'Vol 7 Complex',
      'T09 Chronicles',
      ['123 45', '123 45'],
      ['Naruto 9999', 'Naruto 9999'],
    ];

    for (const entry of cases) {
      const input = Array.isArray(entry) ? entry[0] : entry;
      const expected = Array.isArray(entry) ? entry[1] : entry;
      it(`preserves "${input}"`, () => {
        expect(stripVolumeMarker(input)).toBe(expected);
      });
    }
  });

  describe('strips mid-string volume markers', () => {
    const cases: Array<[string, string]> = [
      ['Killing Bites Vol. 0001 Ch. 0001 - Galactica Scanlations', 'Killing Bites'],
      ['Historys Strongest Disciple Kenichi_v11_c90-98', 'Historys Strongest Disciple Kenichi'],
      ['BTOOOM! v01 (2013) (Digital)', 'BTOOOM!'],
      ['My Girlfriend Is Shobitch v01 - ch. 09 - pg. 008', 'My Girlfriend Is Shobitch'],
      ['Dance in the Vampire Bund v16-17 (Digital)', 'Dance in the Vampire Bund'],
      ['Akame ga KILL! ZERO v01 (2016) (Digital) (LuCaZ).cbz', 'Akame ga KILL! ZERO'],
      ['Tonikaku Cawaii [Volume 11].cbz', 'Tonikaku Cawaii'],
      ['Mujaki no Rakuen Vol12 ch76', 'Mujaki no Rakuen'],
      ['Gantz.V26', 'Gantz'],
      ['Volume 12 - Janken Boy', 'Janken Boy'],
    ];

    for (const [input, expected] of cases) {
      it(`strips "${input}" -> "${expected}"`, () => {
        expect(stripVolumeMarker(input)).toBe(expected);
      });
    }
  });

  describe('replaces underscores with spaces', () => {
    const cases: Array<[string, string]> = [
      ['B_Gata_H_Kei_v01[SlowManga]', 'B Gata H Kei'],
      ['Vagabond_v03', 'Vagabond'],
    ];

    for (const [input, expected] of cases) {
      it(`strips "${input}" -> "${expected}"`, () => {
        expect(stripVolumeMarker(input)).toBe(expected);
      });
    }
  });

  it('returns empty string for empty input', () => {
    expect(stripVolumeMarker('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(stripVolumeMarker('  Death Note  ')).toBe('Death Note');
  });

  it('stops recursion at depth 3 for pathological input', () => {
    // Deeply nested brackets that would cause repeated recursion
    const pathological = 'Title T01 T02 T03 T04 T05';
    const result = stripVolumeMarker(pathological);
    // After depth 3, it returns the result without further recursion
    expect(typeof result).toBe('string');
    // Should have stripped some but not all volume markers
    expect(result.length).toBeLessThan(pathological.length);
  });
});

describe('extractVolumeNumber', () => {
  const cases: Array<[string, number | undefined]> = [
    // Existing trailing patterns
    ['Death Note T09', 9],
    ['Death Note Tome 09', 9],
    ['Death Note vol09', 9],
    ['Death Note v09', 9],
    ['Death Note volume 09', 9],
    ['Death Note issue 09', 9],
    ['Death Note Vol. 9', 9],
    ['Death Note ch12', 12],
    ['Death Note chapter 12', 12],
    ['Fairy Tail 13', 13],
    ['Fairy Tail T13', 13],
    ['Fairy Tail v13', 13],
    ['Fairy Tail 13 [Hiro Mashima] [Manga FR] [Digital-1246]', 13],
    ['Naruto Vol.72 2014', 72],
    ['Naruto 1-5', 1],
    ['Death Note Vol.1-3', 1],
    ['Berserk Vol. 42.5', 42],
    ['Death Note', undefined],
    ['Death Note T0', undefined],
    ['13', undefined],
    ['', undefined],
    ['Naruto 2014', undefined],
    ['Naruto T2014', undefined],
    ['Naruto v2014', undefined],
    ['Berserk 1989', undefined],
    ['1984', undefined],
    // New mid-string patterns
    ['Killing Bites Vol. 0001 Ch. 0001 - Galactica Scanlations', 1],
    ['My Girlfriend Is Shobitch v01 - ch. 09 - pg. 008', 1],
    ['Historys Strongest Disciple Kenichi_v11_c90-98', 11],
    ['B_Gata_H_Kei_v01[SlowManga]', 1],
    ['BTOOOM! v01 (2013) (Digital)', 1],
    ['Gokukoku no Brynhildr - c001-008 (v01)', 1],
    ['Dance in the Vampire Bund v16-17 (Digital)', 16],
    ['Akame ga KILL! ZERO v01 (2016) (Digital) (LuCaZ).cbz', 1],
    ['Tonikaku Cawaii [Volume 11].cbz', 11],
    ['[WS]_Ichiban_Ushiro_no_Daimaou_v02_ch10', 2],
    ['Mujaki no Rakuen Vol12 ch76', 12],
    ['Kodomo no Jikan vol. 1', 1],
    ['Vagabond_v03', 3],
    ['Volume 12 - Janken Boy', 12],
    ['Gantz.V26', 26],
    ['NEEDLESS_Vol.4_-Simeon', 4],
    ['Sword Art Online Vol 10 - Alicization', 10],
    ['Hentai Ouji to Warawanai Neko. - Vol. 06 Ch. 034.5', 6],
    ['The 100 Girlfriends - Vol. 03.5', 3],
    ['Dance in the Vampire Bund {Special Edition} v03.5', 3],
    ['Daredevil - t6 - 10 - (2019)', 6],
    ['Conquistador_Tome_2', 2],
    ["Chevaliers d'Héliopolis T3 - Rubedo", 3],
    // Multilingual patterns
    ['幽游白书完全版 第03卷 天下', 3],
    ['阿衰online 第1册', 1],
    ['スライム...1巻', 1],
    ['スライム...1-3巻', 1],
    ['Kebab Том 1 Глава 3', 1],
    ['Манга Тома 1-4', 1],
    ['동의보감 13권', 13],
    ['몰?루 7.5권', 7],
    ['63권#200', 63],
    ['시즌34', 34],
    ['시즌3-4', 3],
    ['เล่ม 5', 5],
    ['เล่มที่ 12', 12],
    ['卷5', 5],
    ['册10', 10],
    ['제5권', 5],
    ['10장', 10],
    ['Test 5巻', 5],
    ['Series 10-15巻', 10],
  ];

  for (const [input, expected] of cases) {
    const label = expected !== undefined ? `extracts ${expected} from "${input}"` : `returns undefined for "${input}"`;
    it(label, () => {
      expect(extractVolumeNumber(input)).toBe(expected);
    });
  }
});

describe('extractChapterNumber', () => {
  const cases: Array<[string, number | undefined]> = [
    ['Death Note Vol. 4 Ch. 12', 12],
    ['Naruto c090-098', 90],
    ['Bleach_001-003', 1],
    ['Killing Bites Vol. 0001 Ch. 0001', 1],
    ['Monster Ch. 001', 1],
    ['Chapter 63 - The Promise', 63],
    ['#001', 1],
    ['Death Note Tome 04 - c03', 3],
    ['Death Note Tome 04', undefined],
    ['Death Note', undefined],
    ['', undefined],
    ['Chp. 1', 1],
    ['Chp 1', 1],
    ['#201', 201],
    ['Chapter 001', 1],
    ['Chapter 029', 29],
    // Chinese/Japanese chapter markers
    ['第25话', 25],
    ['第10話', 10],
    ['第13回', 13],
    // Thai chapter markers
    ['ตอนที่ 3', 3],
    ['บทที่ 112', 112],
    // Russian chapter markers
    ['Глава 3', 3],
    // Korean chapter markers
    ['106화', 106],
    ['13회', 13],
  ];

  for (const [input, expected] of cases) {
    const label = expected !== undefined ? `extracts ${expected} from "${input}"` : `returns undefined for "${input}"`;
    it(label, () => {
      expect(extractChapterNumber(input)).toBe(expected);
    });
  }
});

describe('detectLanguageHint', () => {
  const cases: Array<[string, string | undefined]> = [
    ['[Manga FR]', 'fr'],
    ['[Manga EN]', 'en'],
    ['[Manga ES]', 'es'],
    ['[Anime JP]', 'jp'],
    ['[Scan IT]', 'it'],
    ['Fairy Tail 13', undefined],
    ['[Digital-1246]', undefined],
    ['Fairy Tail 13 [Manga FR] [Digital-1246]', 'fr'],
  ];

  for (const [input, expected] of cases) {
    const label = expected !== undefined ? `detects "${expected}" from "${input}"` : `returns undefined for "${input}"`;
    it(label, () => {
      expect(detectLanguageHint(input)).toBe(expected);
    });
  }
});

describe('stripVolumeMarker with non-Latin brackets', () => {
  const cases: Array<[string, string]> = [
    ['Naruto 《13》', 'Naruto'],
    ['Fairy Tail 【13】', 'Fairy Tail'],
    ['Naruto 《13》 [Manga JP]', 'Naruto'],
  ];

  for (const [input, expected] of cases) {
    it(`strips "${input}" -> "${expected}"`, () => {
      expect(stripVolumeMarker(input)).toBe(expected);
    });
  }
});
