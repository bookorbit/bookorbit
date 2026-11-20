import {
  buildAudioTimeline,
  locateItemByNarratedSeconds,
  narratedSecondsToTimelineSeconds,
  readAloudDurationsMatch,
  timelineSecondsToNarratedSeconds,
} from './epub-media-overlay-timeline';

function clip(audioHref: string, begin: number, end: number | null) {
  return { audioHref, clipBeginSeconds: begin, clipEndSeconds: end, durationSeconds: end == null ? null : Math.max(0, end - begin) };
}

describe('epub media overlay audio timeline', () => {
  it('lays each track end to end by how far its clips reach, not by how long the clips are', () => {
    const timeline = buildAudioTimeline([clip('a.mp4', 1, 100), clip('a.mp4', 100, 180), clip('b.mp4', 0, 60), clip('b.mp4', 70, 90)]);

    expect(timeline).toEqual({
      tracks: [
        { href: 'a.mp4', startSeconds: 0, spanSeconds: 180 },
        { href: 'b.mp4', startSeconds: 180, spanSeconds: 90 },
      ],
      totalSeconds: 270,
    });
  });

  it('reaches as far as a clip that has no end or ends before it begins', () => {
    expect(buildAudioTimeline([clip('a.mp4', 40, null)])?.totalSeconds).toBe(40);
    expect(buildAudioTimeline([clip('a.mp4', 7223.15, 7198.408)])?.totalSeconds).toBe(7223.15);
  });

  it('has no timeline for clips that reach nowhere', () => {
    expect(buildAudioTimeline([])).toBeNull();
    expect(buildAudioTimeline([clip('a.mp4', 0, 0)])).toBeNull();
  });

  it('accepts an audiobook within five percent of the timeline, and no more than five minutes off', () => {
    expect(readAloudDurationsMatch(31288, 31274)).toBe(true);
    expect(readAloudDurationsMatch(31288, 19604)).toBe(false);
    expect(readAloudDurationsMatch(104, 100)).toBe(true);
    expect(readAloudDurationsMatch(106, 100)).toBe(false);
    expect(readAloudDurationsMatch(100, 0)).toBe(false);
  });

  describe('with pauses between the clips', () => {
    const items = [clip('a.mp4', 0, 100), clip('a.mp4', 400, 500), clip('b.mp4', 50, 150)];
    const timeline = buildAudioTimeline(items)!;

    it('places the narration clock on the timeline', () => {
      expect(narratedSecondsToTimelineSeconds(items, timeline, 0)).toBe(0);
      expect(narratedSecondsToTimelineSeconds(items, timeline, 150)).toBe(450);
      expect(narratedSecondsToTimelineSeconds(items, timeline, 250)).toBe(600);
    });

    it('places the timeline on the narration clock', () => {
      expect(timelineSecondsToNarratedSeconds(items, timeline, 450)).toBe(150);
      expect(timelineSecondsToNarratedSeconds(items, timeline, 600)).toBe(250);
    });

    it('lands on the sentence about to be spoken from a pause, and on the first before any is spoken', () => {
      expect(timelineSecondsToNarratedSeconds(items, timeline, 250)).toBe(100);
      expect(timelineSecondsToNarratedSeconds(items, timeline, 520)).toBe(200);
      expect(timelineSecondsToNarratedSeconds([clip('a.mp4', 30, 60)], buildAudioTimeline([clip('a.mp4', 30, 60)])!, 10)).toBe(0);
    });

    it('finds the sentence a narration second falls in, and the last one past the end', () => {
      expect(locateItemByNarratedSeconds(items, 150)).toEqual({ item: items[1], startSeconds: 100 });
      expect(locateItemByNarratedSeconds(items, 9999)).toEqual({ item: items[2], startSeconds: 200 });
      expect(locateItemByNarratedSeconds([], 5)).toBeNull();
    });
  });
});
