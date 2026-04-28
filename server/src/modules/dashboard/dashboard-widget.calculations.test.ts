import {
  buildDaysSeries,
  computeAuthorSpread,
  computeChallengeResult,
  computeDailySeed,
  computeDiversityScore,
  computeEraRange,
  computeGenreBreadth,
  computeLanguageVariety,
  computeLengthScore,
  computeProjection,
  computeReadingDna,
  computeRhythm,
  computeRhythmScore,
  computeSpeedScore,
  computeTimeScore,
  computeVarietyScore,
  findEligibleChallenges,
  pickAnnotationIndex,
  selectChallenge,
} from './dashboard-widget.calculations';

describe('computeDailySeed', () => {
  it('returns a non-negative integer', () => {
    const seed = computeDailySeed(42, '2026-04-28');
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it('is deterministic for same inputs', () => {
    expect(computeDailySeed(42, '2026-04-28')).toBe(computeDailySeed(42, '2026-04-28'));
  });

  it('differs for different users', () => {
    expect(computeDailySeed(1, '2026-04-28')).not.toBe(computeDailySeed(2, '2026-04-28'));
  });

  it('differs for different dates', () => {
    expect(computeDailySeed(42, '2026-04-28')).not.toBe(computeDailySeed(42, '2026-04-29'));
  });
});

describe('pickAnnotationIndex', () => {
  it('returns -1 when total is 0', () => {
    expect(pickAnnotationIndex(42, '2026-04-28', 0)).toBe(-1);
  });

  it('returns -1 when total is negative', () => {
    expect(pickAnnotationIndex(42, '2026-04-28', -5)).toBe(-1);
  });

  it('returns a valid index within range', () => {
    const idx = pickAnnotationIndex(42, '2026-04-28', 100);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(100);
  });

  it('returns 0 when total is 1', () => {
    expect(pickAnnotationIndex(42, '2026-04-28', 1)).toBe(0);
  });
});

describe('findEligibleChallenges', () => {
  const basePatterns = {
    avgPageCount: 200,
    uniqueGenresLast6Months: 10,
    staleInProgressCount: 0,
    currentStreak: 10,
    maxStreakThisMonth: 10,
    topAuthorBookCount: 1,
    totalBooksRead: 20,
    pagesThisMonth: 0,
  };

  it('includes short-read when avg page count > 250', () => {
    const result = findEligibleChallenges({ ...basePatterns, avgPageCount: 300 });
    expect(result).toContain('short-read');
  });

  it('includes genre-explorer when genres < 5', () => {
    const result = findEligibleChallenges({ ...basePatterns, uniqueGenresLast6Months: 3 });
    expect(result).toContain('genre-explorer');
  });

  it('includes finish-oldest when stale books exist', () => {
    const result = findEligibleChallenges({ ...basePatterns, staleInProgressCount: 2 });
    expect(result).toContain('finish-oldest');
  });

  it('includes streak-builder when maxStreakThisMonth < 5', () => {
    const result = findEligibleChallenges({ ...basePatterns, maxStreakThisMonth: 3 });
    expect(result).toContain('streak-builder');
  });

  it('excludes streak-builder when maxStreakThisMonth >= 5', () => {
    const result = findEligibleChallenges({ ...basePatterns, maxStreakThisMonth: 7 });
    expect(result).not.toContain('streak-builder');
  });

  it('includes new-author when top author has 4+ books', () => {
    const result = findEligibleChallenges({ ...basePatterns, topAuthorBookCount: 5 });
    expect(result).toContain('new-author');
  });

  it('always includes page-milestone', () => {
    const result = findEligibleChallenges(basePatterns);
    expect(result).toContain('page-milestone');
  });
});

describe('selectChallenge', () => {
  it('returns page-milestone when no eligible challenges', () => {
    expect(selectChallenge([], 42, 2026, 4)).toBe('page-milestone');
  });

  it('is deterministic for same inputs', () => {
    const eligible = ['short-read', 'genre-explorer', 'page-milestone'] as const;
    const a = selectChallenge([...eligible], 42, 2026, 4);
    const b = selectChallenge([...eligible], 42, 2026, 4);
    expect(a).toBe(b);
  });

  it('may differ for different months', () => {
    const eligible = ['short-read', 'genre-explorer', 'page-milestone'] as const;
    const a = selectChallenge([...eligible], 42, 2026, 4);
    const b = selectChallenge([...eligible], 42, 2026, 5);
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
  });
});

describe('computeChallengeResult', () => {
  const baseProgress = {
    shortBooksCompleted: 0,
    newGenresRead: 0,
    oldestInProgressFinished: false,
    maxStreakThisMonth: 0,
    newAuthorsRead: 0,
    pagesReadThisMonth: 0,
  };

  it('computes page-milestone progress correctly', () => {
    const result = computeChallengeResult('page-milestone', { ...baseProgress, pagesReadThisMonth: 300 }, 2026, 4);
    expect(result.progress).toBe(300);
    expect(result.target).toBe(500);
    expect(result.completed).toBe(false);
    expect(result.month).toBe(4);
    expect(result.year).toBe(2026);
  });

  it('caps progress at target', () => {
    const result = computeChallengeResult('page-milestone', { ...baseProgress, pagesReadThisMonth: 999 }, 2026, 4);
    expect(result.progress).toBe(500);
    expect(result.completed).toBe(true);
  });

  it('handles streak-builder correctly', () => {
    const result = computeChallengeResult('streak-builder', { ...baseProgress, maxStreakThisMonth: 7 }, 2026, 4);
    expect(result.progress).toBe(5);
    expect(result.completed).toBe(true);
  });

  it('handles streak-builder incomplete', () => {
    const result = computeChallengeResult('streak-builder', { ...baseProgress, maxStreakThisMonth: 3 }, 2026, 4);
    expect(result.progress).toBe(3);
    expect(result.completed).toBe(false);
  });

  it('handles short-read when completed', () => {
    const result = computeChallengeResult('short-read', { ...baseProgress, shortBooksCompleted: 1 }, 2026, 4);
    expect(result.progress).toBe(1);
    expect(result.completed).toBe(true);
  });

  it('handles short-read when incomplete', () => {
    const result = computeChallengeResult('short-read', baseProgress, 2026, 4);
    expect(result.progress).toBe(0);
    expect(result.completed).toBe(false);
  });

  it('handles genre-explorer when completed', () => {
    const result = computeChallengeResult('genre-explorer', { ...baseProgress, newGenresRead: 1 }, 2026, 4);
    expect(result.progress).toBe(1);
    expect(result.completed).toBe(true);
  });

  it('handles finish-oldest when completed', () => {
    const result = computeChallengeResult('finish-oldest', { ...baseProgress, oldestInProgressFinished: true }, 2026, 4);
    expect(result.progress).toBe(1);
    expect(result.completed).toBe(true);
  });

  it('handles finish-oldest when incomplete', () => {
    const result = computeChallengeResult('finish-oldest', baseProgress, 2026, 4);
    expect(result.progress).toBe(0);
    expect(result.completed).toBe(false);
  });

  it('handles new-author when completed', () => {
    const result = computeChallengeResult('new-author', { ...baseProgress, newAuthorsRead: 2 }, 2026, 4);
    expect(result.progress).toBe(1);
    expect(result.completed).toBe(true);
  });
});

describe('computeProjection', () => {
  it('projects correctly with active reading', () => {
    const result = computeProjection({
      booksCompletedYtd: 10,
      booksCompletedLast30Days: 3,
      pagesReadLast30Days: 900,
      hoursReadLast30Days: 30,
      daysInYear: 365,
      dayOfYear: 100,
      prevProjectedBooks: null,
    });

    expect(result.projectedBooks).toBeGreaterThan(10);
    expect(result.projectedPages).toBeGreaterThan(0);
    expect(result.projectedHours).toBeGreaterThan(0);
    expect(result.daysRemaining).toBe(265);
    expect(result.trend).toBe('stable');
  });

  it('never projects fewer books than already completed', () => {
    const result = computeProjection({
      booksCompletedYtd: 50,
      booksCompletedLast30Days: 0,
      pagesReadLast30Days: 0,
      hoursReadLast30Days: 0,
      daysInYear: 365,
      dayOfYear: 300,
      prevProjectedBooks: null,
    });
    expect(result.projectedBooks).toBe(50);
  });

  it('detects upward trend', () => {
    const result = computeProjection({
      booksCompletedYtd: 10,
      booksCompletedLast30Days: 5,
      pagesReadLast30Days: 1500,
      hoursReadLast30Days: 50,
      daysInYear: 365,
      dayOfYear: 100,
      prevProjectedBooks: 30,
    });
    expect(result.trend).toBe('up');
  });

  it('detects downward trend', () => {
    const result = computeProjection({
      booksCompletedYtd: 10,
      booksCompletedLast30Days: 1,
      pagesReadLast30Days: 200,
      hoursReadLast30Days: 5,
      daysInYear: 365,
      dayOfYear: 100,
      prevProjectedBooks: 50,
    });
    expect(result.trend).toBe('down');
  });
});

describe('Reading DNA calculations', () => {
  describe('computeLengthScore', () => {
    it('returns 0 for 0 pages', () => {
      expect(computeLengthScore(0)).toBe(0);
    });

    it('caps at 100', () => {
      expect(computeLengthScore(1000)).toBe(100);
    });

    it('scales linearly to 500 pages', () => {
      expect(computeLengthScore(250)).toBe(50);
    });
  });

  describe('computeVarietyScore', () => {
    it('returns 0 when no books', () => {
      expect(computeVarietyScore(5, 0)).toBe(0);
    });

    it('returns high score when many unique genres', () => {
      expect(computeVarietyScore(10, 10)).toBe(100);
    });

    it('returns low score when few unique genres', () => {
      expect(computeVarietyScore(1, 20)).toBe(10);
    });
  });

  describe('computeRhythmScore', () => {
    it('returns 0 for 0 ratio', () => {
      expect(computeRhythmScore(0)).toBe(0);
    });

    it('returns 100 for 100% ratio', () => {
      expect(computeRhythmScore(1.0)).toBe(100);
    });
  });

  describe('computeTimeScore', () => {
    it('returns 0 for midnight', () => {
      expect(computeTimeScore(0)).toBe(0);
    });

    it('returns 100 for hour 23', () => {
      expect(computeTimeScore(23)).toBe(100);
    });
  });

  describe('computeSpeedScore', () => {
    it('returns 0 for 0 pages/hour', () => {
      expect(computeSpeedScore(0)).toBe(0);
    });

    it('caps at 100 for very fast readers', () => {
      expect(computeSpeedScore(80)).toBe(100);
      expect(computeSpeedScore(200)).toBe(100);
    });

    it('scores ~50 at 40 pages/hour (mid-range)', () => {
      expect(computeSpeedScore(40)).toBe(50);
    });

    it('returns Slow Savorer threshold boundary: score 30 at 24 pages/hour', () => {
      expect(computeSpeedScore(24)).toBe(30);
    });

    it('returns Steady Pacer threshold boundary: score 60 at 48 pages/hour', () => {
      expect(computeSpeedScore(48)).toBe(60);
    });

    it('clamps to 0 for negative input', () => {
      expect(computeSpeedScore(-10)).toBe(0);
    });
  });

  describe('computeReadingDna', () => {
    it('returns valid archetype and scores', () => {
      const dna = computeReadingDna(300, 5, 20, 0.8, 21, null);
      expect(dna.archetype).toBeTruthy();
      expect(dna.lengthScore).toBeGreaterThanOrEqual(0);
      expect(dna.lengthScore).toBeLessThanOrEqual(100);
      expect(dna.booksAnalyzed).toBe(20);
      expect(dna.lengthLabel).toBeTruthy();
      expect(dna.varietyLabel).toBeTruthy();
      expect(dna.rhythmLabel).toBeTruthy();
      expect(dna.timeLabel).toBeTruthy();
      expect(dna.speedLabel).toBeTruthy();
    });

    it('identifies Deep Specialist for low variety', () => {
      const dna = computeReadingDna(200, 1, 20, 0.5, 12, null);
      expect(dna.archetype).toBe('Deep Specialist');
    });

    it('identifies Steady Eclectic Explorer', () => {
      const dna = computeReadingDna(400, 15, 20, 0.9, 14, null);
      expect(dna.archetype).toBe('Steady Eclectic Explorer');
    });

    it('returns speedScore=0 and speedLabel="N/A" when no speed data', () => {
      const dna = computeReadingDna(300, 5, 20, 0.5, 14, null);
      expect(dna.speedScore).toBe(0);
      expect(dna.speedLabel).toBe('N/A');
    });

    it('returns speedLabel for valid speed data', () => {
      const dna = computeReadingDna(300, 5, 20, 0.5, 14, 30);
      expect(dna.speedScore).toBeGreaterThan(0);
      expect(dna.speedLabel).not.toBe('N/A');
    });

    it('identifies Slow Savorer for slow speed and long books', () => {
      // avgPageCount=600 -> lengthScore=100 (>60), speed=10 pages/hr -> speedScore=12 (<=30)
      const dna = computeReadingDna(600, 5, 20, 0.5, 14, 10);
      expect(dna.archetype).toBe('Slow Savorer');
    });

    it('identifies Rapid Explorer for fast speed and eclectic variety', () => {
      // uniqueGenres=20, totalBooks=20 -> varietyScore=100 (>60), speed=80 pages/hr -> speedScore=100 (>60)
      const dna = computeReadingDna(300, 20, 20, 0.5, 14, 80);
      expect(dna.archetype).toBe('Rapid Explorer');
    });

    it('identifies Speed Demon for fast speed and bursty rhythm', () => {
      // readingDaysRatio=0.1 -> rhythmScore=10 (<=30), speed=80 pages/hr -> speedScore=100 (>60)
      // variety must be <= 60 so Rapid Explorer does not trigger first
      const dna = computeReadingDna(300, 3, 10, 0.1, 14, 80);
      expect(dna.archetype).toBe('Speed Demon');
    });

    it('identifies Patient Specialist for slow speed and focused variety', () => {
      // uniqueGenres=1, totalBooks=20 -> varietyScore=10 (<=30), speed=10 pages/hr -> speedScore=12 (<=30)
      // rhythmScore must be > 30 so Weekend Binge Reader does not win
      const dna = computeReadingDna(300, 1, 20, 0.5, 14, 10);
      expect(dna.archetype).toBe('Patient Specialist');
    });

    it('skips speed archetypes when speed data is null even if scores would otherwise match', () => {
      // Same conditions as Patient Specialist but no speed data -> falls to Deep Specialist
      const dna = computeReadingDna(300, 1, 20, 0.5, 14, null);
      expect(dna.archetype).toBe('Deep Specialist');
    });

    it('speed archetypes do not override higher-priority 3-condition archetypes', () => {
      // long + eclectic + steady -> Steady Eclectic Explorer (priority 2)
      // also has fast speed + eclectic -> would be Rapid Explorer (priority 6)
      const dna = computeReadingDna(600, 20, 20, 0.9, 14, 80);
      expect(dna.archetype).toBe('Steady Eclectic Explorer');
    });
  });
});

describe('Diversity Score calculations', () => {
  describe('computeGenreBreadth', () => {
    it('returns 0 when no genres in library', () => {
      expect(computeGenreBreadth(5, 0)).toBe(0);
    });

    it('returns 100 when all genres read', () => {
      expect(computeGenreBreadth(10, 10)).toBe(100);
    });
  });

  describe('computeAuthorSpread', () => {
    it('returns 0 when no books read', () => {
      expect(computeAuthorSpread(5, 0)).toBe(0);
    });

    it('returns 100 when every book is a different author', () => {
      expect(computeAuthorSpread(10, 10)).toBe(100);
    });
  });

  describe('computeEraRange', () => {
    it('returns 0 for 0 or 1 years', () => {
      expect(computeEraRange([])).toBe(0);
      expect(computeEraRange([2020])).toBe(0);
    });

    it('returns 100 for 100+ year span', () => {
      expect(computeEraRange([1900, 2000])).toBe(100);
    });

    it('scales linearly', () => {
      expect(computeEraRange([2000, 2050])).toBe(50);
    });
  });

  describe('computeLanguageVariety', () => {
    it('returns 0 for 0 languages', () => {
      expect(computeLanguageVariety(0)).toBe(0);
    });

    it('returns 100 for 5+ languages', () => {
      expect(computeLanguageVariety(5)).toBe(100);
    });
  });

  describe('computeDiversityScore', () => {
    it('returns valid composite score', () => {
      const result = computeDiversityScore(5, 10, 8, 15, [1990, 2020], 3);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.label).toBeTruthy();
      expect(result.booksAnalyzed).toBe(15);
    });

    it('returns Deep Specialist label for low scores', () => {
      const result = computeDiversityScore(1, 20, 2, 20, [2020], 1);
      expect(result.label).toBe('Deep Specialist');
    });
  });
});

describe('Reading Rhythm calculations', () => {
  describe('buildDaysSeries', () => {
    it('fills missing days with zeroes', () => {
      const today = new Date('2026-04-28T12:00:00Z');
      const result = buildDaysSeries([], today, 7);
      expect(result).toHaveLength(7);
      expect(result.every((d) => d.readingSeconds === 0)).toBe(true);
    });

    it('maps existing data to correct dates', () => {
      const today = new Date('2026-04-28T12:00:00Z');
      const data = [{ day: '2026-04-28', readingSeconds: 600 }];
      const result = buildDaysSeries(data, today, 3);

      expect(result).toHaveLength(3);
      expect(result[2]!.date).toBe('2026-04-28');
      expect(result[2]!.readingSeconds).toBe(600);
      expect(result[0]!.readingSeconds).toBe(0);
    });

    it('orders oldest to newest', () => {
      const today = new Date('2026-04-28T12:00:00Z');
      const result = buildDaysSeries([], today, 3);
      expect(result[0]!.date).toBe('2026-04-26');
      expect(result[2]!.date).toBe('2026-04-28');
    });
  });

  describe('computeRhythm', () => {
    it('returns zeroes for empty input', () => {
      const result = computeRhythm([]);
      expect(result.consistencyPercent).toBe(0);
      expect(result.avgSecondsPerDay).toBe(0);
      expect(result.activeDays).toBe(0);
      expect(result.totalDays).toBe(0);
    });

    it('computes consistency correctly', () => {
      const days = [
        { readingSeconds: 600 },
        { readingSeconds: 0 },
        { readingSeconds: 300 },
        { readingSeconds: 0 },
        { readingSeconds: 1200 },
        { readingSeconds: 0 },
        { readingSeconds: 0 },
      ];
      const result = computeRhythm(days);

      expect(result.activeDays).toBe(3);
      expect(result.totalDays).toBe(7);
      expect(result.consistencyPercent).toBe(43);
    });

    it('computes average correctly', () => {
      const days = [{ readingSeconds: 100 }, { readingSeconds: 200 }, { readingSeconds: 300 }];
      const result = computeRhythm(days);
      expect(result.avgSecondsPerDay).toBe(200);
      expect(result.activeDays).toBe(3);
      expect(result.consistencyPercent).toBe(100);
    });
  });
});
