import { compareCfi } from './cfi.utils';

describe('compareCfi', () => {
  it('orders positions by chapter, then by path within the chapter, then by character offset', () => {
    expect(compareCfi('epubcfi(/6/18!/4/2/168/6/1:0)', 'epubcfi(/6/20!/4/2/14/1:0)')).toBeLessThan(0);
    expect(compareCfi('epubcfi(/6/20!/4/2/86/1:0)', 'epubcfi(/6/20!/4/2/82/8/1:92)')).toBeGreaterThan(0);
    expect(compareCfi('epubcfi(/6/20!/4/2/82/8/1:10)', 'epubcfi(/6/20!/4/2/82/8/1:92)')).toBeLessThan(0);
    expect(compareCfi('epubcfi(/6/20!/4/2/82/8/1:92)', 'epubcfi(/6/20!/4/2/82/8/1:92)')).toBe(0);
  });

  it('compares a range by its start and an ancestor before its descendants', () => {
    expect(compareCfi('epubcfi(/6/20!/4/2,/82/8[chapter6-s153]/1:92,/88/1:5)', 'epubcfi(/6/20!/4/2/84/1:0)')).toBeLessThan(0);
    expect(compareCfi('epubcfi(/6/20!/4/2/82)', 'epubcfi(/6/20!/4/2/82/8/1:0)')).toBeLessThan(0);
  });

  it('returns null when either position cannot be read', () => {
    expect(compareCfi('not a cfi', 'epubcfi(/6/20!/4/2/82/8/1:0)')).toBeNull();
    expect(compareCfi('epubcfi(/4/2/82)', 'epubcfi(/6/20!/4/2/82/8/1:0)')).toBeNull();
  });
});
