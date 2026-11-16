import type { ReadAloudChapterReport, ReadAloudReportSummary } from '@bookorbit/types';

import { assessCoverage, InvalidReportError, parseAlignmentReport, type ReadAloudTrackReport, reportWarnings } from './read-aloud-report';
import { classifyReadAloudError, ReadAloudJobError } from './read-aloud-errors';
import { WorkerJobNotFoundError, WorkerRejectedError, WorkerUnreachableError } from './read-aloud-worker-client.service';
import { GeneratedFileError } from '../upload/generated-book-file.service';
import { REPORT_TOTALS } from './test-helpers';

function report(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 4,
    totals: { ...REPORT_TOTALS, spine: { aligned: 1 } },
    spine: [
      {
        index: 0,
        href: 'OEBPS/title.xhtml',
        title: 'Title Page',
        status: 'excluded',
        classification: { zone: 'front', verdict: 'exclude', decidedBy: 'title', signals: [] },
        decision: null,
        sentenceCount: 2,
        matchedSentenceCount: 0,
        interpolatedSentenceCount: 0,
        droppedSentenceCount: 0,
        matchedSeconds: 0,
        score: null,
        preview: 'A   Novel\n by Someone',
        firstMatch: null,
        lastMatch: null,
      },
      {
        index: 1,
        href: 'OEBPS/chapter-1.xhtml',
        title: 'Chapter 1',
        status: 'aligned',
        classification: { zone: 'body', verdict: 'include', decidedBy: null, signals: [] },
        decision: 'approved',
        sentenceCount: 98,
        matchedSentenceCount: 98,
        interpolatedSentenceCount: 1,
        droppedSentenceCount: 0,
        matchedSeconds: 590,
        score: 0.93,
        preview: 'It was a dark night.',
        firstMatch: { prevSentence: null, matchedSentence: 'It was a dark night.', nextSentence: 'Rain fell.' },
        lastMatch: { prevSentence: 'Rain fell.', matchedSentence: 'The end.', nextSentence: null },
      },
      { href: 'broken.xhtml', status: 'unknown-status' },
      'not an object',
    ],
    ...overrides,
  });
}

describe('parseAlignmentReport', () => {
  it('reads totals and trims chapters to what the review table needs', () => {
    const parsed = parseAlignmentReport(report());

    expect(parsed.totals).toEqual(REPORT_TOTALS);
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]).toMatchObject({
      href: 'OEBPS/title.xhtml',
      zone: 'front',
      status: 'excluded',
      decision: null,
      preview: 'A Novel by Someone',
    });
    expect(parsed.chapters[1]).toMatchObject({
      zone: 'body',
      decision: 'approved',
      score: 0.93,
      firstMatch: 'It was a dark night.',
      lastMatch: 'The end.',
    });
  });

  it('rejects a report without valid totals or with another version', () => {
    expect(() => parseAlignmentReport('{')).toThrow(InvalidReportError);
    expect(() => parseAlignmentReport(JSON.stringify({ totals: { ...REPORT_TOTALS, sentences: -1 } }))).toThrow(InvalidReportError);
    expect(() => parseAlignmentReport(report({ version: 5 }))).toThrow(InvalidReportError);
  });

  it('caps long snippets', () => {
    const long = 'word '.repeat(200);
    const parsed = parseAlignmentReport(report({ spine: [{ href: 'a.xhtml', status: 'aligned', preview: long }] }));
    expect(parsed.chapters[0]!.preview!.length).toBeLessThanOrEqual(280);
  });

  it('reads the track list whole, or not at all', () => {
    const track = { index: 0, name: '0001.mp4', duration: 38, offset: 0, matchedSeconds: 0, interpolatedSeconds: 0, looseSeconds: 38, excluded: [] };
    expect(parseAlignmentReport(report({ tracks: [track] })).tracks).toEqual([{ duration: 38, matchedSeconds: 0, interpolatedSeconds: 0 }]);
    expect(parseAlignmentReport(report()).tracks).toBeNull();
    expect(parseAlignmentReport(report({ tracks: [track, { ...track, duration: -1 }] })).tracks).toBeNull();
    expect(parseAlignmentReport(report({ tracks: [track, 'not a track'] })).tracks).toBeNull();
  });
});

/** The Briar Club as aligned: duration and placed seconds per track, in playback order. */
const BRIAR_CLUB_TRACKS: [number, number][] = [
  [38, 0], // opening credits
  [16, 15.8],
  [291, 291],
  [8, 0], // "Four and a Half Years Earlier. June 1950."
  [4375, 4375],
  [262, 258.7],
  [7, 0],
  [4329.1, 4329.1],
  [4323.3, 4323.3],
  [238.6, 237.4],
  [7.2, 0],
  [2934.8, 2934.7],
  [2897.1, 2893.7],
  [285, 285],
  [7.1, 2],
  [3185.9, 3185.9],
  [3272, 3272],
  [265.4, 261.7],
  [8.7, 2.6],
  [3036.3, 3036.3],
  [2930.7, 2930.7],
  [146, 142.3],
  [8.4, 3.1],
  [3518.7, 3518.7],
  [3492, 3492],
  [190, 185.8],
  [8, 0],
  [3628.2, 3628.2],
  [3645.1, 3645.1],
  [2092.8, 2092.8],
  [1423.4, 1423.4],
  [443.7, 435.6],
  [1286, 1286],
  [1539, 93.8],
  [76.8, 39.2],
];

function tracksOf(entries: [number, number][]): ReadAloudTrackReport[] {
  return entries.map(([duration, placed]) => ({ duration, matchedSeconds: placed, interpolatedSeconds: 0 }));
}

function withTracks(tracks: ReadAloudTrackReport[]): ReadAloudReportSummary {
  const unaligned = tracks.filter((track) => track.matchedSeconds === 0 && track.interpolatedSeconds === 0).length;
  return { ...REPORT_TOTALS, tracks: tracks.length, unalignedTracks: unaligned };
}

describe('reportWarnings', () => {
  it('flags review only past the thresholds', () => {
    expect(reportWarnings(REPORT_TOTALS, null)).toEqual({ warnings: [], requiresReview: false });
    expect(reportWarnings({ ...REPORT_TOTALS, unmatchedSentences: 7 }, null)).toEqual({ warnings: ['unmatched_text'], requiresReview: false });
    expect(reportWarnings({ ...REPORT_TOTALS, unmatchedSentences: 11 }, null).requiresReview).toBe(true);
    expect(reportWarnings({ ...REPORT_TOTALS, unalignedTracks: 1 }, null)).toEqual({ warnings: ['unaligned_tracks'], requiresReview: true });
    expect(reportWarnings({ ...REPORT_TOTALS, matchedSentences: 0 }, null).requiresReview).toBe(true);
  });

  it('publishes past credits and spoken part headings, keeping the warning', () => {
    const tracks = tracksOf(BRIAR_CLUB_TRACKS);
    expect(reportWarnings(withTracks(tracks), null, tracks)).toEqual({ warnings: ['unaligned_tracks'], requiresReview: false });
  });

  it('counts a track as placed when only estimated timing landed in it', () => {
    const tracks = tracksOf([
      [600, 590],
      [300, 0],
      [600, 590],
    ]);
    tracks[1] = { ...tracks[1]!, interpolatedSeconds: 4 };
    expect(reportWarnings(withTracks(tracks), null, tracks)).toEqual({ warnings: [], requiresReview: false });
  });

  it('keeps the review for unaligned audio long enough to be a chapter', () => {
    const inside = tracksOf(BRIAR_CLUB_TRACKS);
    inside[7] = { duration: 4329.1, matchedSeconds: 0, interpolatedSeconds: 0 };
    expect(reportWarnings(withTracks(inside), null, inside).requiresReview).toBe(true);

    const shortChapter = tracksOf([
      [600, 590],
      [21, 0],
      [600, 590],
    ]);
    expect(reportWarnings(withTracks(shortChapter), null, shortChapter).requiresReview).toBe(true);

    const longOpening = tracksOf([
      [121, 0],
      [600, 590],
    ]);
    expect(reportWarnings(withTracks(longOpening), null, longOpening).requiresReview).toBe(true);

    const bonusInterview = tracksOf([
      [600, 590],
      [1539, 0],
      [76.8, 0],
    ]);
    expect(reportWarnings(withTracks(bonusInterview), null, bonusInterview).requiresReview).toBe(true);
  });

  it('keeps the review when short unaligned tracks add up', () => {
    const tracks = tracksOf([[100, 0], [100, 0], [600, 590], ...Array.from({ length: 5 }, (): [number, number] => [10, 0]), [600, 590]]);
    expect(reportWarnings(withTracks(tracks), null, tracks).requiresReview).toBe(true);
  });

  it('keeps the review when the track list is missing or disagrees with the totals', () => {
    const tracks = tracksOf(BRIAR_CLUB_TRACKS);
    const totals = withTracks(tracks);
    expect(reportWarnings(totals, null, null).requiresReview).toBe(true);
    expect(reportWarnings({ ...totals, unalignedTracks: 4 }, null, tracks).requiresReview).toBe(true);
    expect(reportWarnings({ ...totals, tracks: 34 }, null, tracks).requiresReview).toBe(true);
    const silent = tracksOf([
      [10, 0],
      [10, 0],
    ]);
    expect(reportWarnings({ ...withTracks(silent), matchedSentences: 1 }, null, silent).requiresReview).toBe(true);
  });
});

function chapter(
  index: number,
  title: string,
  zone: ReadAloudChapterReport['zone'],
  sentences: number,
  matched: number,
  status: ReadAloudChapterReport['status'] = matched > 0 ? 'aligned' : 'not-found',
): ReadAloudChapterReport {
  return {
    index,
    href: `text/part${index}.html`,
    title,
    zone,
    status,
    decision: null,
    sentenceCount: sentences,
    matchedSentenceCount: matched,
    interpolatedSentenceCount: 0,
    droppedSentenceCount: 0,
    matchedSeconds: matched * 3,
    score: null,
    preview: null,
    firstMatch: null,
    lastMatch: null,
    outsideNarration: false,
  };
}

function totalsOf(chapters: ReadAloudChapterReport[]): ReadAloudReportSummary {
  const sentences = chapters.reduce((total, entry) => total + entry.sentenceCount, 0);
  const matched = chapters.reduce((total, entry) => total + entry.matchedSentenceCount, 0);
  return { ...REPORT_TOTALS, sentences, matchedSentences: matched, interpolatedSentences: 0, unmatchedSentences: sentences - matched };
}

/** The shape of a real run: front matter, a fully read story, then acknowledgments and a sample of another book. */
function novel(): ReadAloudChapterReport[] {
  return [
    chapter(0, 'Copyright', 'front', 10, 0),
    chapter(1, 'Table of Contents', 'front', 39, 0),
    chapter(2, 'Dedication', 'front', 2, 0),
    chapter(3, 'Chapter One', 'front', 231, 231),
    ...Array.from({ length: 30 }, (_, offset) => chapter(4 + offset, `Chapter ${offset + 2}`, 'body', 200, 200)),
    chapter(34, 'Chapter Thirty-Two', 'back', 180, 180),
    chapter(35, 'Acknowledgments', 'back', 190, 0),
    chapter(36, 'Contact the Author', 'back', 6, 5),
    chapter(37, 'All Your Perfects', 'back', 420, 0),
  ];
}

describe('assessCoverage', () => {
  it('sets aside front and back matter the narration never reads, so a clean book carries no warning', () => {
    const chapters = novel();
    const totals = totalsOf(chapters);
    expect(reportWarnings(totals, null).warnings).toEqual(['unmatched_text']);

    const { coverage, chapters: marked } = assessCoverage(totals, chapters);
    expect(coverage).toEqual({
      storySentences: totals.sentences - 662,
      storyUnmatchedSentences: 0,
      outsideSentences: 662,
      outsideChapterCount: 5,
      outsideTitles: ['Copyright', 'Table of Contents', 'Dedication', 'Acknowledgments', 'All Your Perfects'],
    });
    expect(marked.filter((entry) => entry.outsideNarration).map((entry) => entry.index)).toEqual([0, 1, 2, 35, 37]);
    expect(reportWarnings(totals, coverage)).toEqual({ warnings: [], requiresReview: false });
  });

  it('never calls a chapter with audio "not in the narration", but sets aside its unread lines', () => {
    const chapters = [
      chapter(0, 'Dedication', 'front', 4, 3),
      chapter(1, 'Prologue', 'front', 59, 59),
      ...Array.from({ length: 10 }, (_, offset) => chapter(2 + offset, `Chapter ${offset + 1}`, 'body', 200, 200)),
      chapter(12, 'Acknowledgments', 'back', 11, 6),
      chapter(13, 'About the Author', 'back', 5, 0),
    ];
    const totals = totalsOf(chapters);
    const { coverage, chapters: marked } = assessCoverage(totals, chapters);

    expect(marked.filter((entry) => entry.outsideNarration).map((entry) => entry.title)).toEqual(['About the Author']);
    expect(coverage).toEqual({
      storySentences: totals.sentences - 11,
      storyUnmatchedSentences: 0,
      outsideSentences: 11,
      outsideChapterCount: 1,
      outsideTitles: ['About the Author'],
    });
  });

  it('counts estimated timing as audio when deciding a chapter has none', () => {
    const chapters = [chapter(0, 'Dedication', 'front', 2, 0), chapter(1, 'Chapter 1', 'body', 200, 200)];
    chapters[0] = { ...chapters[0]!, interpolatedSentenceCount: 1 };
    const { coverage, chapters: marked } = assessCoverage(totalsOf(chapters), chapters);
    expect(marked[0]!.outsideNarration).toBe(false);
    expect(coverage).toMatchObject({ outsideSentences: 1, outsideChapterCount: 0, outsideTitles: [] });
  });

  it('counts a gap inside the story, and sets aside only what lies beyond the last matched chapter', () => {
    const chapters = novel();
    chapters[10] = chapter(10, 'Chapter Eight', 'body', 400, 0);
    chapters[34] = chapter(34, 'Chapter Thirty-Two', 'back', 180, 0);
    chapters.splice(34, 0, chapter(33, 'Chapter Thirty-One', 'back', 150, 150));
    const totals = totalsOf(chapters);
    const { coverage, chapters: marked } = assessCoverage(totals, chapters);

    expect(marked.find((entry) => entry.title === 'Chapter Eight')?.outsideNarration).toBe(false);
    expect(marked.find((entry) => entry.title === 'Chapter Thirty-Two')?.outsideNarration).toBe(true);
    expect(coverage?.storyUnmatchedSentences).toBe(400);
    expect(reportWarnings(totals, coverage).warnings).toContain('unmatched_text');
  });

  it('treats a mostly unmatched book as the wrong audiobook rather than front and back matter', () => {
    const chapters = [
      chapter(0, 'Preface', 'front', 900, 0),
      chapter(1, 'Chapter 1', 'body', 100, 100),
      chapter(2, 'Chapter 2', 'body', 100, 100),
      chapter(3, 'Appendix', 'back', 900, 0),
    ];
    const totals = totalsOf(chapters);
    const { coverage, chapters: marked } = assessCoverage(totals, chapters);

    expect(marked.some((entry) => entry.outsideNarration)).toBe(false);
    expect(coverage).toMatchObject({ outsideSentences: 0, storyUnmatchedSentences: 1800 });
    expect(reportWarnings(totals, coverage).requiresReview).toBe(true);
  });

  it('names an untitled page by its opening words, never by its file path', () => {
    const chapters = novel();
    chapters[0] = {
      ...chapters[0]!,
      title: null,
      preview: 'Copyright © 2018 by Colleen Hoover. All rights reserved. No part of this book may be used',
    };
    chapters[2] = { ...chapters[2]!, title: null, preview: null };
    const { coverage } = assessCoverage(totalsOf(chapters), chapters);
    expect(coverage?.outsideTitles.slice(0, 3)).toEqual(['Copyright © 2018 by Colleen Hoover.…', 'Table of Contents', 'part2.html']);
  });

  it('sets nothing aside when no chapter clearly matched, and has nothing to measure without chapters', () => {
    const chapters = [chapter(0, 'Intro', 'front', 30, 0), chapter(1, 'One', 'body', 40, 10), chapter(2, 'End', 'back', 30, 0)];
    expect(assessCoverage(totalsOf(chapters), chapters).coverage).toMatchObject({ outsideSentences: 0, outsideChapterCount: 0 });
    expect(assessCoverage(REPORT_TOTALS, [])).toEqual({ coverage: null, chapters: [] });
  });
});

describe('classifyReadAloudError', () => {
  it('keeps raw system codes away from the client', () => {
    expect(classifyReadAloudError(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe('unknown');
    expect(classifyReadAloudError(Object.assign(new Error('dup'), { code: '23505' }))).toBe('unknown');
  });

  it('maps known failures to their codes', () => {
    expect(classifyReadAloudError(new ReadAloudJobError('source_changed', 'x'))).toBe('source_changed');
    expect(classifyReadAloudError(new WorkerRejectedError('library_not_mounted', 'x'))).toBe('library_not_mounted');
    expect(classifyReadAloudError(new WorkerUnreachableError('x'))).toBe('worker_unavailable');
    expect(classifyReadAloudError(new WorkerJobNotFoundError('id'))).toBe('worker_unavailable');
    expect(classifyReadAloudError(new InvalidReportError('x'))).toBe('invalid_output');
    expect(classifyReadAloudError(new GeneratedFileError('insufficient_storage', 'x'))).toBe('insufficient_storage');
    expect(classifyReadAloudError(new GeneratedFileError('invalid_content', 'x'))).toBe('invalid_output');
    expect(classifyReadAloudError(new GeneratedFileError('not_allowed', 'x'))).toBe('publication_failed');
  });
});
