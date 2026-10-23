import { audioBookPercentageAt, compareBookFilePaths, remapAudioBookPosition, type AudioTrackSpan } from './audio-track-order.utils';

describe('compareBookFilePaths', () => {
  it('keeps disc folders together instead of interleaving tracks that share a name', () => {
    const files = ['/b/Book/CD 2/01.mp3', '/b/Book/CD 1/02.mp3', '/b/Book/CD 2/02.mp3', '/b/Book/CD 1/01.mp3'];
    expect(files.sort(compareBookFilePaths)).toEqual(['/b/Book/CD 1/01.mp3', '/b/Book/CD 1/02.mp3', '/b/Book/CD 2/01.mp3', '/b/Book/CD 2/02.mp3']);
  });

  it('orders disc numbers naturally', () => {
    const files = ['/b/Book/Disc 10/01.mp3', '/b/Book/Disc 2/01.mp3', '/b/Book/Disc 1/01.mp3'];
    expect(files.sort(compareBookFilePaths)).toEqual(['/b/Book/Disc 1/01.mp3', '/b/Book/Disc 2/01.mp3', '/b/Book/Disc 10/01.mp3']);
  });

  it('is natural file-name order within one folder', () => {
    const files = ['/b/Book 2/Part 10.mp3', '/b/Book 2/Part 2.mp3', '/b/Book 2/Part 1.mp3'];
    expect(files.sort(compareBookFilePaths)).toEqual(['/b/Book 2/Part 1.mp3', '/b/Book 2/Part 2.mp3', '/b/Book 2/Part 10.mp3']);
  });
});

describe('remapAudioBookPosition', () => {
  // Interleaved: CD1/01 (100), CD2/01 (200), CD1/02 (300). Grouped: CD1/01, CD1/02, CD2/01.
  const interleaved: AudioTrackSpan[] = [
    { fileId: 1, durationSeconds: 100 },
    { fileId: 3, durationSeconds: 200 },
    { fileId: 2, durationSeconds: 300 },
  ];
  const grouped: AudioTrackSpan[] = [
    { fileId: 1, durationSeconds: 100 },
    { fileId: 2, durationSeconds: 300 },
    { fileId: 3, durationSeconds: 200 },
  ];

  it('keeps a position on the same moment of the same track', () => {
    expect(remapAudioBookPosition(50, interleaved, grouped)).toBe(50);
    expect(remapAudioBookPosition(150, interleaved, grouped)).toBe(450);
    expect(remapAudioBookPosition(350, interleaved, grouped)).toBe(150);
  });

  it('places a track boundary at the start of the following track', () => {
    expect(remapAudioBookPosition(100, interleaved, grouped)).toBe(400);
    expect(remapAudioBookPosition(0, interleaved, grouped)).toBe(0);
  });

  it('keeps a position past the end inside the last track of the old order', () => {
    expect(remapAudioBookPosition(900, interleaved, grouped)).toBe(400);
    expect(remapAudioBookPosition(-5, interleaved, grouped)).toBe(0);
  });

  it('cannot place a position when a track length is unknown', () => {
    expect(remapAudioBookPosition(50, [{ fileId: 1, durationSeconds: null }, ...interleaved.slice(1)], grouped)).toBeNull();
    expect(remapAudioBookPosition(50, interleaved, [{ fileId: 1, durationSeconds: 0 }, ...grouped.slice(1)])).toBeNull();
  });

  it('cannot place a position when the orders hold different tracks', () => {
    expect(remapAudioBookPosition(50, interleaved, grouped.slice(0, 2))).toBeNull();
    expect(remapAudioBookPosition(50, interleaved, [...grouped.slice(0, 2), { fileId: 9, durationSeconds: 200 }])).toBeNull();
    expect(remapAudioBookPosition(50, [], [])).toBeNull();
  });
});

describe('audioBookPercentageAt', () => {
  const order: AudioTrackSpan[] = [
    { fileId: 1, durationSeconds: 100 },
    { fileId: 2, durationSeconds: 300 },
  ];

  it('is the share of the book reached at an offset into a track', () => {
    expect(audioBookPercentageAt(order, 2, 100)).toBe(50);
    expect(audioBookPercentageAt(order, 1, 0)).toBe(0);
    expect(audioBookPercentageAt(order, 2, 1000)).toBe(100);
  });

  it('is null for a track outside the order or an unknown length', () => {
    expect(audioBookPercentageAt(order, 9, 10)).toBeNull();
    expect(audioBookPercentageAt([{ fileId: 1, durationSeconds: null }], 1, 10)).toBeNull();
  });
});
