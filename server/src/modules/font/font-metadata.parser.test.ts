import { parseFontMetadata } from './font-metadata.parser';
import {
  LANG_WINDOWS_EN_GB,
  LANG_WINDOWS_EN_US,
  LANG_WINDOWS_JAPANESE,
  PLATFORM_WINDOWS,
  buildFvarTable,
  buildNameTable,
  buildOs2Table,
  buildSfnt,
  buildWoff,
  buildWoff2,
  macName,
  windowsName,
} from './font-test-fixtures';

describe('parseFontMetadata', () => {
  describe('container formats', () => {
    it('parses a TrueType font (version 1.0 signature)', () => {
      const font = buildSfnt([
        { tag: 'name', data: buildNameTable([windowsName(1, 'Literata'), windowsName(2, 'Bold')]) },
        { tag: 'OS/2', data: buildOs2Table({ usWeightClass: 700, fsSelection: 32 }) },
      ]);

      expect(parseFontMetadata(font)).toEqual({
        familyName: 'Literata',
        subfamilyName: 'Bold',
        usWeightClass: 700,
        fsSelection: 32,
        axes: [],
        instances: [],
      });
    });

    it.each([
      ['true', Buffer.from('true', 'latin1')],
      ['typ1', Buffer.from('typ1', 'latin1')],
      ['OTTO', Buffer.from('OTTO', 'latin1')],
    ])('parses a font with the %s signature', (_label, signature) => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'Iosevka')]) }], signature);
      expect(parseFontMetadata(font).familyName).toBe('Iosevka');
    });

    it('rejects a truncated WOFF2 header', () => {
      const font = Buffer.alloc(32);
      font.write('wOF2', 0, 4, 'latin1');
      expect(() => parseFontMetadata(font)).toThrow(/WOFF2 header is truncated/);
    });

    it('rejects an unrecognized signature', () => {
      expect(() => parseFontMetadata(Buffer.alloc(64, 0xff))).toThrow(/Unrecognized font signature/);
    });

    it('rejects a buffer too small to hold a table directory', () => {
      expect(() => parseFontMetadata(Buffer.from([0x00, 0x01, 0x00, 0x00]))).toThrow(/too small/);
    });

    it('rejects a truncated WOFF header', () => {
      const font = Buffer.alloc(20);
      font.write('wOFF', 0, 4, 'latin1');
      expect(() => parseFontMetadata(font)).toThrow(/WOFF header is truncated/);
    });

    it('rejects an implausible table count rather than allocating for it', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'X')]) }], undefined, 60000);
      expect(() => parseFontMetadata(font)).toThrow(/Implausible table count/);
    });

    it('rejects a zero table count', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'X')]) }], undefined, 0);
      expect(() => parseFontMetadata(font)).toThrow(/Implausible table count/);
    });

    it('rejects a directory that extends past the end of the font', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'X')]) }], undefined, 400);
      expect(() => parseFontMetadata(font)).toThrow(/extends past end/);
    });
  });

  describe('name table', () => {
    it('decodes Windows UTF-16BE names', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'Noto Sans JP'), windowsName(2, 'Regular')]) }]);
      const result = parseFontMetadata(font);
      expect(result.familyName).toBe('Noto Sans JP');
      expect(result.subfamilyName).toBe('Regular');
    });

    it('decodes Macintosh latin1 names', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([macName(1, 'Charter'), macName(2, 'Italic')]) }]);
      const result = parseFontMetadata(font);
      expect(result.familyName).toBe('Charter');
      expect(result.subfamilyName).toBe('Italic');
    });

    it('prefers typographic names so weight variants group under one family', () => {
      const font = buildSfnt([
        {
          tag: 'name',
          data: buildNameTable([
            windowsName(1, 'Source Han Sans Light'),
            windowsName(2, 'Regular'),
            windowsName(16, 'Source Han Sans'),
            windowsName(17, 'Light'),
          ]),
        },
      ]);

      const result = parseFontMetadata(font);
      expect(result.familyName).toBe('Source Han Sans');
      expect(result.subfamilyName).toBe('Light');
    });

    it('falls back to legacy names when typographic names are absent', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'Legacy Only'), windowsName(2, 'Bold')]) }]);
      const result = parseFontMetadata(font);
      expect(result.familyName).toBe('Legacy Only');
      expect(result.subfamilyName).toBe('Bold');
    });

    it('prefers the Windows record when Windows and Mac both provide English', () => {
      const font = buildSfnt([
        {
          tag: 'name',
          data: buildNameTable([macName(1, 'Mac Variant'), windowsName(1, 'Windows Variant')]),
        },
      ]);
      expect(parseFontMetadata(font).familyName).toBe('Windows Variant');
    });

    it('accepts non-US English variants such as en-GB', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'Gill Sans', LANG_WINDOWS_EN_GB)]) }]);
      expect(parseFontMetadata(font).familyName).toBe('Gill Sans');
    });

    it('ignores non-English records and keeps the English name', () => {
      const font = buildSfnt([
        {
          tag: 'name',
          data: buildNameTable([windowsName(1, 'Japanese Name', LANG_WINDOWS_JAPANESE), windowsName(1, 'English Name')]),
        },
      ]);
      expect(parseFontMetadata(font).familyName).toBe('English Name');
    });

    it('returns null names when every record is non-English', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'Japanese Only', LANG_WINDOWS_JAPANESE)]) }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('returns null names when the font has no name table', () => {
      const font = buildSfnt([{ tag: 'OS/2', data: buildOs2Table({ usWeightClass: 400 }) }]);
      const result = parseFontMetadata(font);
      expect(result.familyName).toBeNull();
      expect(result.subfamilyName).toBeNull();
      expect(result.usWeightClass).toBe(400);
    });

    it('skips a record whose string extends past the end of the table', () => {
      const data = buildNameTable([{ platformID: PLATFORM_WINDOWS, languageID: LANG_WINDOWS_EN_US, nameID: 1, value: 'X', offsetOverride: 60000 }]);
      const font = buildSfnt([{ tag: 'name', data }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('stops cleanly when the record count exceeds the actual record data', () => {
      const data = buildNameTable([windowsName(1, 'Truncated')], 500);
      const font = buildSfnt([{ tag: 'name', data }]);
      expect(parseFontMetadata(font).familyName).toBe('Truncated');
    });

    it('skips an odd-length UTF-16 value rather than throwing', () => {
      const data = buildNameTable([
        { platformID: PLATFORM_WINDOWS, languageID: LANG_WINDOWS_EN_US, nameID: 1, value: '', rawValue: Buffer.from([0x00, 0x41, 0x00]) },
      ]);
      const font = buildSfnt([{ tag: 'name', data }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('ignores a whitespace-only name', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, '   ')]) }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('does not mutate the caller buffer while byte-swapping UTF-16 names', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'Immutable')]) }]);
      const before = Buffer.from(font);

      expect(parseFontMetadata(font).familyName).toBe('Immutable');
      expect(font.equals(before)).toBe(true);
    });
  });

  describe('OS/2 table', () => {
    it('reads weight class and fsSelection', () => {
      const font = buildSfnt([{ tag: 'OS/2', data: buildOs2Table({ usWeightClass: 350, fsSelection: 1 }) }]);
      const result = parseFontMetadata(font);
      expect(result.usWeightClass).toBe(350);
      expect(result.fsSelection).toBe(1);
    });

    it('returns undefined fields when the font has no OS/2 table', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'No OS2')]) }]);
      const result = parseFontMetadata(font);
      expect(result.usWeightClass).toBeUndefined();
      expect(result.fsSelection).toBeUndefined();
    });

    it('still reads the weight when the table is too short to hold fsSelection', () => {
      const font = buildSfnt([{ tag: 'OS/2', data: buildOs2Table({ usWeightClass: 600, length: 32 }) }]);
      const result = parseFontMetadata(font);
      expect(result.usWeightClass).toBe(600);
      expect(result.fsSelection).toBeUndefined();
    });
  });

  describe('WOFF', () => {
    it('reads uncompressed WOFF tables', () => {
      const font = buildWoff([
        { tag: 'name', data: buildNameTable([windowsName(1, 'Woff Family'), windowsName(2, 'Italic')]) },
        { tag: 'OS/2', data: buildOs2Table({ usWeightClass: 300, fsSelection: 1 }) },
      ]);

      expect(parseFontMetadata(font)).toEqual({
        familyName: 'Woff Family',
        subfamilyName: 'Italic',
        usWeightClass: 300,
        fsSelection: 1,
        axes: [],
        instances: [],
      });
    });

    it('inflates zlib-compressed WOFF tables', () => {
      const font = buildWoff([
        { tag: 'name', data: buildNameTable([windowsName(1, 'Compressed Family')]), compress: true },
        { tag: 'OS/2', data: buildOs2Table({ usWeightClass: 800, fsSelection: 0 }), compress: true },
      ]);

      const result = parseFontMetadata(font);
      expect(result.familyName).toBe('Compressed Family');
      expect(result.usWeightClass).toBe(800);
    });

    it('returns null for a table whose compressed bytes are corrupt', () => {
      const font = buildWoff([
        { tag: 'name', data: Buffer.from('not actually deflate data'), declaredOrigLength: 9999 },
        { tag: 'OS/2', data: buildOs2Table({ usWeightClass: 400 }) },
      ]);

      const result = parseFontMetadata(font);
      expect(result.familyName).toBeNull();
      expect(result.usWeightClass).toBe(400);
    });
  });

  describe('malformed and hostile input', () => {
    it('returns null for a table whose offset points past the end of the font', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'X')]), declaredOffset: 900000 }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('returns null for a table declaring a length past the end of the font', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'X')]), declaredLength: 900000 }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('refuses a metadata table declaring an absurd size', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'X')]), declaredLength: 64 * 1024 * 1024 }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('refuses to inflate a decompression bomb', () => {
      // 8 MB of zeros compresses to a few KB and would inflate past the metadata cap.
      const bomb = Buffer.alloc(8 * 1024 * 1024, 0);
      const font = buildWoff([{ tag: 'name', data: bomb, compress: true, declaredOrigLength: bomb.length }]);
      expect(parseFontMetadata(font).familyName).toBeNull();
    });

    it('ignores tables other than name and OS/2', () => {
      const font = buildSfnt([
        { tag: 'glyf', data: Buffer.alloc(1024, 0xab) },
        { tag: 'name', data: buildNameTable([windowsName(1, 'Selective')]) },
        { tag: 'loca', data: Buffer.alloc(512, 0xcd) },
      ]);
      expect(parseFontMetadata(font).familyName).toBe('Selective');
    });
  });

  describe('scale', () => {
    it('parses a 40 MB font without cost growing with file size', () => {
      // A real CJK font is large because of its glyph data. Padding stands in for that:
      // the parser must never touch it, so both time and heap stay flat.
      const glyphData = Buffer.alloc(40 * 1024 * 1024, 0x00);
      const font = buildSfnt([
        { tag: 'name', data: buildNameTable([windowsName(16, 'Source Han Sans'), windowsName(17, 'Bold')]) },
        { tag: 'OS/2', data: buildOs2Table({ usWeightClass: 700, fsSelection: 32 }) },
        { tag: 'glyf', data: glyphData },
      ]);

      const heapBefore = process.memoryUsage().heapUsed;
      const startedAt = process.hrtime.bigint();
      const result = parseFontMetadata(font);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const heapGrowthMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

      expect(result).toEqual({
        familyName: 'Source Han Sans',
        subfamilyName: 'Bold',
        usWeightClass: 700,
        fsSelection: 32,
        axes: [],
        instances: [],
      });
      // A full parse of a font this size cost hundreds of megabytes and hundreds of ms.
      expect(heapGrowthMb).toBeLessThan(25);
      expect(elapsedMs).toBeLessThan(250);
    });
  });

  describe('variation axes', () => {
    const variableFont = (fvar: Buffer, names = [windowsName(1, 'Inter'), windowsName(256, 'Light'), windowsName(257, 'Bold')]) =>
      buildSfnt([
        { tag: 'name', data: buildNameTable(names) },
        { tag: 'OS/2', data: buildOs2Table({ usWeightClass: 400 }) },
        { tag: 'fvar', data: fvar },
      ]);

    it('reads the weight axis range', () => {
      const font = variableFont(buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }]));

      expect(parseFontMetadata(font).axes).toEqual([{ tag: 'wght', min: 100, default: 400, max: 900 }]);
    });

    it('reads every axis, not just weight', () => {
      const font = variableFont(
        buildFvarTable([
          { tag: 'wght', min: 200, default: 400, max: 800 },
          { tag: 'wdth', min: 75, default: 100, max: 125 },
          { tag: 'slnt', min: -10, default: 0, max: 0 },
        ]),
      );

      expect(parseFontMetadata(font).axes.map((axis) => axis.tag)).toEqual(['wght', 'wdth', 'slnt']);
    });

    it('resolves named instances against the name table', () => {
      const font = variableFont(
        buildFvarTable(
          [{ tag: 'wght', min: 100, default: 400, max: 900 }],
          [
            { subfamilyNameID: 256, coordinates: [300] },
            { subfamilyNameID: 257, coordinates: [700] },
          ],
        ),
      );

      expect(parseFontMetadata(font).instances).toEqual([
        { name: 'Light', coordinates: { wght: 300 } },
        { name: 'Bold', coordinates: { wght: 700 } },
      ]);
    });

    it('reports an instance whose name id is missing rather than dropping it', () => {
      const font = variableFont(buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [{ subfamilyNameID: 999, coordinates: [500] }]));

      expect(parseFontMetadata(font).instances).toEqual([{ name: null, coordinates: { wght: 500 } }]);
    });

    it('reads instances that carry the optional PostScript name id', () => {
      const font = variableFont(
        buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [{ subfamilyNameID: 256, coordinates: [300], postScriptNameID: 300 }]),
      );

      expect(parseFontMetadata(font).instances).toEqual([{ name: 'Light', coordinates: { wght: 300 } }]);
    });

    it('reads coordinates across multiple axes', () => {
      const font = variableFont(
        buildFvarTable(
          [
            { tag: 'wght', min: 100, default: 400, max: 900 },
            { tag: 'wdth', min: 75, default: 100, max: 125 },
          ],
          [{ subfamilyNameID: 257, coordinates: [700, 125] }],
        ),
      );

      expect(parseFontMetadata(font).instances).toEqual([{ name: 'Bold', coordinates: { wght: 700, wdth: 125 } }]);
    });

    it('reports no axes for a static font', () => {
      const font = buildSfnt([{ tag: 'name', data: buildNameTable([windowsName(1, 'Literata')]) }]);

      expect(parseFontMetadata(font)).toMatchObject({ axes: [], instances: [] });
    });

    it.each([
      ['an axis count of zero', buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [], { axisCount: 0 })],
      ['an implausible axis count', buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [], { axisCount: 5000 })],
      ['an axis size below the minimum', buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [], { axisSize: 8 })],
      [
        'an axis array running past the table',
        buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [], { declaredAxesArrayOffset: 4096 }),
      ],
    ])('ignores a malformed fvar table declaring %s', (_label, fvar) => {
      expect(parseFontMetadata(variableFont(fvar))).toMatchObject({ axes: [], instances: [], familyName: 'Inter' });
    });

    it('stops at the last instance the table can hold', () => {
      const fvar = buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [{ subfamilyNameID: 256, coordinates: [300] }], {
        instanceCount: 50,
      });

      expect(parseFontMetadata(variableFont(fvar)).instances).toHaveLength(1);
    });

    it('ignores instance records too short to hold a coordinate per axis', () => {
      const fvar = buildFvarTable([{ tag: 'wght', min: 100, default: 400, max: 900 }], [{ subfamilyNameID: 256, coordinates: [300] }], {
        instanceSize: 4,
      });

      expect(parseFontMetadata(variableFont(fvar))).toMatchObject({ axes: [{ tag: 'wght', min: 100, default: 400, max: 900 }], instances: [] });
    });
  });

  describe('WOFF2', () => {
    it('reads metadata out of the compressed stream', () => {
      const font = buildWoff2([
        { tag: 'name', data: buildNameTable([windowsName(1, 'Recursive'), windowsName(2, 'Italic')]) },
        { tag: 'OS/2', data: buildOs2Table({ usWeightClass: 300, fsSelection: 1 }) },
      ]);

      expect(parseFontMetadata(font)).toMatchObject({
        familyName: 'Recursive',
        subfamilyName: 'Italic',
        usWeightClass: 300,
        fsSelection: 1,
      });
    });

    it('reads fvar past a transformed glyf table, whose stored length differs from its own', () => {
      const font = buildWoff2([
        { tag: 'name', data: buildNameTable([windowsName(1, 'Recursive'), windowsName(256, 'SemiBold')]) },
        { tag: 'glyf', data: Buffer.alloc(2048, 0x11), transformed: true },
        { tag: 'fvar', data: buildFvarTable([{ tag: 'wght', min: 300, default: 400, max: 1000 }], [{ subfamilyNameID: 256, coordinates: [600] }]) },
      ]);

      expect(parseFontMetadata(font)).toMatchObject({
        familyName: 'Recursive',
        axes: [{ tag: 'wght', min: 300, default: 400, max: 1000 }],
        instances: [{ name: 'SemiBold', coordinates: { wght: 600 } }],
      });
    });

    it('refuses a font declaring an expansion beyond the limit', () => {
      const font = buildWoff2([{ tag: 'name', data: buildNameTable([windowsName(1, 'Huge')]) }], { totalSfntSize: 64 * 1024 * 1024 });

      expect(() => parseFontMetadata(font)).toThrow(/too large to expand/);
    });

    it('rejects a font collection, which carries more than one face', () => {
      const font = buildWoff2([{ tag: 'name', data: buildNameTable([windowsName(1, 'Collection')]) }]);
      font.write('ttcf', 4, 4, 'latin1');

      expect(() => parseFontMetadata(font)).toThrow(/collections are not supported/);
    });

    it('rejects a truncated table directory', () => {
      const font = buildWoff2([{ tag: 'name', data: buildNameTable([windowsName(1, 'Truncated')]) }], { numTables: 40 });

      expect(() => parseFontMetadata(font)).toThrow(/WOFF2/);
    });

    it('skips the brotli stream entirely when no table of interest is present', () => {
      const font = buildWoff2([{ tag: 'cmap', data: Buffer.alloc(64, 0x22) }]);

      expect(parseFontMetadata(font)).toMatchObject({ familyName: null, axes: [], instances: [] });
    });
  });
});
