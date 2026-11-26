import { decideRegexFields, mergeRegexMetadata } from './merge-regex-metadata';

const chapter = { seriesName: 'Berserk', seriesIndex: '12', seriesUnit: 'chapter' as const, seriesVolumeIndex: '3' };
const file = (seriesIndex: string | null) => ({ seriesName: 'Berserk', seriesIndex, authors: [], genres: [], cover: null });

describe('path rule units', () => {
  it('takes the unit with the number when the rule leads', () => {
    expect(decideRegexFields(file('5'), chapter, true, { units: true })).toMatchObject({
      seriesIndex: '12',
      seriesUnit: 'chapter',
      seriesVolumeIndex: '3',
    });
  });

  it('takes the unit when the file supplied the same number', () => {
    const decided = decideRegexFields(file('012'), chapter, false, { units: true });

    expect(decided).not.toHaveProperty('seriesIndex');
    expect(decided).toMatchObject({ seriesUnit: 'chapter', seriesVolumeIndex: '3' });
  });

  it('leaves the unit undecided when the file kept a different number', () => {
    expect(decideRegexFields(file('5'), chapter, false, { units: true })).not.toHaveProperty('seriesUnit');
  });

  it('clears a stored unit when the rule read a number with no marker', () => {
    expect(decideRegexFields(null, { seriesIndex: '7' }, true, { units: true })).toMatchObject({ seriesUnit: null, seriesVolumeIndex: null });
  });

  it('decides no unit outside comics', () => {
    expect(decideRegexFields(null, chapter, true, { units: false })).not.toHaveProperty('seriesUnit');
    expect(decideRegexFields(null, chapter, true)).not.toHaveProperty('seriesUnit');
  });

  it('carries the decided unit into the merged metadata', () => {
    expect(mergeRegexMetadata(file('12'), chapter, false, { units: true })).toMatchObject({
      seriesIndex: '12',
      seriesUnit: 'chapter',
      seriesVolumeIndex: '3',
    });
    expect(mergeRegexMetadata(file('5'), chapter, false, { units: true })).not.toHaveProperty('seriesUnit');
  });
});
