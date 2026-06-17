import { attr, findInZip, resolvePath, toRecordArray } from './epub-zip-utils';

describe('resolvePath', () => {
  it('joins base and relative href', () => {
    expect(resolvePath('OEBPS/', 'images/cover.jpg')).toBe('OEBPS/images/cover.jpg');
  });
  it('resolves parent segments', () => {
    expect(resolvePath('OEBPS/text/', '../images/cover.jpg')).toBe('OEBPS/images/cover.jpg');
  });
  it('drops current-dir segments', () => {
    expect(resolvePath('OEBPS/', './cover.xhtml')).toBe('OEBPS/cover.xhtml');
  });
});

describe('attr', () => {
  it('returns string attribute values', () => {
    expect(attr({ '@_id': 'cover' }, '@_id')).toBe('cover');
  });
  it('returns empty string for non-string or missing values', () => {
    expect(attr({ '@_id': 5 }, '@_id')).toBe('');
    expect(attr({}, '@_id')).toBe('');
  });
});

describe('toRecordArray', () => {
  it('passes arrays through', () => {
    expect(toRecordArray([{ a: 1 }, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it('wraps a single object', () => {
    expect(toRecordArray({ a: 1 })).toEqual([{ a: 1 }]);
  });
  it('returns empty for null/undefined', () => {
    expect(toRecordArray(null)).toEqual([]);
    expect(toRecordArray(undefined)).toEqual([]);
  });
});

describe('findInZip', () => {
  it('finds an entry resolved against the OPF directory', () => {
    const zip = { files: [{ path: 'OEBPS/images/cover.jpg' }] } as never;
    expect(findInZip(zip, 'images/cover.jpg', 'OEBPS/')?.path).toBe('OEBPS/images/cover.jpg');
  });
  it('matches case-insensitively', () => {
    const zip = { files: [{ path: 'OEBPS/Cover.JPG' }] } as never;
    expect(findInZip(zip, 'cover.jpg', 'OEBPS/')?.path).toBe('OEBPS/Cover.JPG');
  });
  it('handles a leading slash in the zip path', () => {
    const zip = { files: [{ path: '/OEBPS/a.xhtml' }] } as never;
    expect(findInZip(zip, 'a.xhtml', 'OEBPS/')?.path).toBe('/OEBPS/a.xhtml');
  });
  it('decodes percent-encoded hrefs', () => {
    const zip = { files: [{ path: 'OEBPS/a b.xhtml' }] } as never;
    expect(findInZip(zip, 'a%20b.xhtml', 'OEBPS/')?.path).toBe('OEBPS/a b.xhtml');
  });
  it('returns undefined when nothing matches', () => {
    const zip = { files: [{ path: 'OEBPS/cover.jpg' }] } as never;
    expect(findInZip(zip, 'missing.jpg', 'OEBPS/')).toBeUndefined();
  });
});
