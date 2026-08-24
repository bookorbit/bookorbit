import { naturalCompare } from './natural-sort.utils';

describe('naturalCompare', () => {
  it('orders numeric filename parts by value', () => {
    const filenames = ['Part 10.mp3', 'Part 02.mp3', 'Part 01.mp3'];

    expect(filenames.sort(naturalCompare)).toEqual(['Part 01.mp3', 'Part 02.mp3', 'Part 10.mp3']);
  });

  it('orders every numeric run in a filename', () => {
    const filenames = ['Disc 2 - Track 10.mp3', 'Disc 10 - Track 1.mp3', 'Disc 2 - Track 2.mp3'];

    expect(filenames.sort(naturalCompare)).toEqual(['Disc 2 - Track 2.mp3', 'Disc 2 - Track 10.mp3', 'Disc 10 - Track 1.mp3']);
  });
});
