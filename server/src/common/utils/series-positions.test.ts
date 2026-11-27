import { compareSeriesPositions, compareSeriesRuns, seriesRunOf } from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

describe('series positions', () => {
  it('orders issues run by run, then by number', () => {
    const books = [
      { seriesIndex: '2', unit: 'issue', volumeIndex: '3' },
      { seriesIndex: '1', unit: 'issue', volumeIndex: '3' },
      { seriesIndex: '2', unit: 'issue', volumeIndex: '2' },
      { seriesIndex: '1', unit: 'issue', volumeIndex: '2' },
      { seriesIndex: '5', unit: 'issue', volumeIndex: null },
      { seriesIndex: '4', unit: 'volume', volumeIndex: null },
    ];
    expect([...books].sort(compareSeriesPositions).map((book) => `${book.unit}:${book.volumeIndex ?? '-'}:${book.seriesIndex}`)).toEqual([
      'volume:-:4',
      'issue:2:1',
      'issue:2:2',
      'issue:3:1',
      'issue:3:2',
      'issue:-:5',
    ]);
  });

  it('never puts a volume or an unclassified book in a run', () => {
    expect(seriesRunOf('volume', '2')).toBeNull();
    expect(seriesRunOf(null, '2')).toBeNull();
    expect(seriesRunOf('chapter', '2')).toBe('2');
  });

  it('orders runs numerically, with no run last', () => {
    expect(['10', null, '2', '2.5'].sort(compareSeriesRuns)).toEqual(['2', '2.5', '10', null]);
  });
});
