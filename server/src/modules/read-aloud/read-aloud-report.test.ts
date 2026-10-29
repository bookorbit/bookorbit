import type { ReadAloudChapterReport, ReadAloudReportSummary } from '@bookorbit/types';

import { assessCoverage, InvalidReportError, parseAlignmentReport, reportWarnings } from './read-aloud-report';
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
});

describe('reportWarnings', () => {
  it('flags review only past the thresholds', () => {
    expect(reportWarnings(REPORT_TOTALS, null)).toEqual({ warnings: [], requiresReview: false });
    expect(reportWarnings({ ...REPORT_TOTALS, unmatchedSentences: 7 }, null)).toEqual({ warnings: ['unmatched_text'], requiresReview: false });
    expect(reportWarnings({ ...REPORT_TOTALS, unmatchedSentences: 11 }, null).requiresReview).toBe(true);
    expect(reportWarnings({ ...REPORT_TOTALS, unalignedTracks: 1 }, null)).toEqual({ warnings: ['unaligned_tracks'], requiresReview: true });
    expect(reportWarnings({ ...REPORT_TOTALS, matchedSentences: 0 }, null).requiresReview).toBe(true);
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
      outsideChapterCount: 6,
      outsideTitles: ['Copyright', 'Table of Contents', 'Dedication', 'Acknowledgments', 'Contact the Author', 'All Your Perfects'],
    });
    expect(marked.filter((entry) => entry.outsideNarration).map((entry) => entry.index)).toEqual([0, 1, 2, 35, 36, 37]);
    expect(reportWarnings(totals, coverage)).toEqual({ warnings: [], requiresReview: false });
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
