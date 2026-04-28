import type {
  ChallengeType,
  DiversityScoreWidgetData,
  MonthlyChallengeWidgetData,
  ReadingDnaWidgetData,
  ReadingRhythmWidgetData,
  ReadingStreakWidgetData,
  YearProjectionWidgetData,
} from '@bookorbit/types';

// ── Date Helpers ─────────────────────────────────────────────────────

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computeLongestStreak(readDays: Set<string>): number {
  if (readDays.size === 0) return 0;

  const sortedDays = [...readDays].sort();
  let longest = 1;
  let current = 1;

  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1]!);
    const curr = new Date(sortedDays[i]!);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }

  return longest;
}

export function computeStreakData(readDays: Set<string>, today: Date): ReadingStreakWidgetData {
  const todayStr = formatDay(today);

  const lastSevenDays: boolean[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    lastSevenDays.push(readDays.has(formatDay(d)));
  }

  if (readDays.size === 0) {
    return { currentStreak: 0, longestStreak: 0, lastSevenDays };
  }

  let currentStreak = 0;
  const startDate = new Date(today);
  if (!readDays.has(todayStr)) {
    startDate.setUTCDate(startDate.getUTCDate() - 1);
    if (!readDays.has(formatDay(startDate))) {
      return { currentStreak: 0, longestStreak: computeLongestStreak(readDays), lastSevenDays };
    }
  }

  const cursor = new Date(startDate);
  while (readDays.has(formatDay(cursor))) {
    currentStreak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { currentStreak, longestStreak: computeLongestStreak(readDays), lastSevenDays };
}

// ── Highlight of the Day ────────────────────────────────────────────

export function computeDailySeed(userId: number, dateStr: string): number {
  let hash = 0;
  const key = `${userId}:${dateStr}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function pickAnnotationIndex(userId: number, dateStr: string, total: number): number {
  if (total <= 0) return -1;
  return computeDailySeed(userId, dateStr) % total;
}

// ── Monthly Mini Challenge ──────────────────────────────────────────

export interface ReadingPatterns {
  avgPageCount: number;
  uniqueGenresLast6Months: number;
  staleInProgressCount: number;
  currentStreak: number;
  maxStreakThisMonth: number;
  topAuthorBookCount: number;
  totalBooksRead: number;
  pagesThisMonth: number;
}

const CHALLENGE_META: Record<ChallengeType, { title: string; description: string; target: number }> = {
  'short-read': { title: 'Quick Read', description: 'Finish a book under 200 pages this month', target: 1 },
  'genre-explorer': { title: 'Genre Explorer', description: 'Read a book in a genre new to you this month', target: 1 },
  'finish-oldest': { title: 'Clear the Backlog', description: 'Finish your oldest in-progress book', target: 1 },
  'streak-builder': { title: 'Streak Builder', description: 'Read for 5 consecutive days this month', target: 5 },
  'new-author': { title: 'New Voice', description: 'Read a book by an author new to you this month', target: 1 },
  'page-milestone': { title: 'Page Turner', description: 'Read 500 pages this month', target: 500 },
};

export function findEligibleChallenges(patterns: ReadingPatterns): ChallengeType[] {
  const eligible: ChallengeType[] = [];

  if (patterns.avgPageCount > 250) eligible.push('short-read');
  if (patterns.uniqueGenresLast6Months < 5) eligible.push('genre-explorer');
  if (patterns.staleInProgressCount > 0) eligible.push('finish-oldest');
  if (patterns.maxStreakThisMonth < 5) eligible.push('streak-builder');
  if (patterns.topAuthorBookCount > 3) eligible.push('new-author');

  eligible.push('page-milestone');

  return eligible;
}

export function selectChallenge(eligible: ChallengeType[], userId: number, year: number, month: number): ChallengeType {
  if (eligible.length === 0) return 'page-milestone';
  const seed = computeDailySeed(userId, `${year}-${String(month).padStart(2, '0')}`);
  return eligible[seed % eligible.length]!;
}

export interface ChallengeProgress {
  shortBooksCompleted: number;
  newGenresRead: number;
  oldestInProgressFinished: boolean;
  maxStreakThisMonth: number;
  newAuthorsRead: number;
  pagesReadThisMonth: number;
}

export function computeChallengeResult(
  type: ChallengeType,
  progress: ChallengeProgress,
  year: number,
  month: number,
): Omit<MonthlyChallengeWidgetData, 'challengeType'> {
  const meta = CHALLENGE_META[type];
  let current: number;

  switch (type) {
    case 'short-read':
      current = progress.shortBooksCompleted;
      break;
    case 'genre-explorer':
      current = progress.newGenresRead;
      break;
    case 'finish-oldest':
      current = progress.oldestInProgressFinished ? 1 : 0;
      break;
    case 'streak-builder':
      current = progress.maxStreakThisMonth;
      break;
    case 'new-author':
      current = progress.newAuthorsRead;
      break;
    case 'page-milestone':
      current = progress.pagesReadThisMonth;
      break;
  }

  return {
    title: meta.title,
    description: meta.description,
    progress: Math.min(current, meta.target),
    target: meta.target,
    completed: current >= meta.target,
    month,
    year,
  };
}

// ── Year-End Projection ─────────────────────────────────────────────

export interface ProjectionInput {
  booksCompletedYtd: number;
  pagesReadLast30Days: number;
  hoursReadLast30Days: number;
  booksCompletedLast30Days: number;
  daysInYear: number;
  dayOfYear: number;
  prevProjectedBooks: number | null;
}

export function computeProjection(input: ProjectionInput): Omit<YearProjectionWidgetData, 'trend'> & { trend: 'up' | 'down' | 'stable' } {
  const daysRemaining = input.daysInYear - input.dayOfYear;
  const activeDays = 30;

  const booksPerDay = input.booksCompletedLast30Days / activeDays;
  const pagesPerDay = input.pagesReadLast30Days / activeDays;
  const hoursPerDay = input.hoursReadLast30Days / activeDays;

  const projectedBooks = Math.round(input.booksCompletedYtd + booksPerDay * daysRemaining);
  const projectedPages = Math.round(pagesPerDay * input.daysInYear);
  const projectedHours = Math.round(hoursPerDay * input.daysInYear * 10) / 10;

  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (input.prevProjectedBooks != null) {
    if (projectedBooks > input.prevProjectedBooks) trend = 'up';
    else if (projectedBooks < input.prevProjectedBooks) trend = 'down';
  }

  return {
    projectedBooks: Math.max(projectedBooks, input.booksCompletedYtd),
    projectedPages: Math.max(projectedPages, 0),
    projectedHours: Math.max(projectedHours, 0),
    booksCompletedYtd: input.booksCompletedYtd,
    daysRemaining,
    trend,
  };
}

// ── Reading DNA ─────────────────────────────────────────────────────

export function computeLengthScore(avgPageCount: number): number {
  return Math.min(100, Math.round((avgPageCount / 500) * 100));
}

export function computeVarietyScore(uniqueGenres: number, totalBooks: number): number {
  if (totalBooks === 0) return 0;
  const ratio = uniqueGenres / totalBooks;
  return Math.min(100, Math.round(ratio * 200));
}

export function computeRhythmScore(readingDaysRatio: number): number {
  return Math.min(100, Math.round(readingDaysRatio * 100));
}

export function computeTimeScore(peakHour: number): number {
  return Math.min(100, Math.round((peakHour / 23) * 100));
}

export function computeSpeedScore(avgPagesPerHour: number): number {
  return Math.max(0, Math.min(100, Math.round((avgPagesPerHour / 80) * 100)));
}

function getLengthLabel(score: number): string {
  if (score <= 30) return 'Short';
  if (score <= 60) return 'Medium';
  return 'Long';
}

function getVarietyLabel(score: number): string {
  if (score <= 30) return 'Focused';
  if (score <= 60) return 'Balanced';
  return 'Eclectic';
}

function getRhythmLabel(score: number): string {
  if (score <= 30) return 'Bursty';
  if (score <= 60) return 'Moderate';
  return 'Steady';
}

function getTimeLabel(peakHour: number): string {
  if (peakHour < 6) return 'Night Owl';
  if (peakHour < 12) return 'Early Bird';
  if (peakHour < 18) return 'Afternoon';
  return 'Evening';
}

function getSpeedLabel(score: number): string {
  if (score <= 30) return 'Slow Savorer';
  if (score <= 60) return 'Steady Pacer';
  return 'Speed Demon';
}

interface DnaTraits {
  lengthScore: number;
  varietyScore: number;
  rhythmScore: number;
  timeLabel: string;
  speedScore: number | null;
}

const ARCHETYPES: [predicate: (traits: DnaTraits) => boolean, label: string][] = [
  [({ lengthScore, varietyScore, timeLabel }) => lengthScore > 60 && varietyScore <= 30 && timeLabel === 'Night Owl', 'Night Owl Epic Specialist'],
  [({ lengthScore, varietyScore, rhythmScore }) => lengthScore > 60 && varietyScore > 60 && rhythmScore > 60, 'Steady Eclectic Explorer'],
  [({ varietyScore, rhythmScore }) => varietyScore > 60 && rhythmScore > 60, 'Disciplined Genre Hopper'],
  [({ lengthScore, timeLabel }) => lengthScore > 60 && timeLabel === 'Early Bird', 'Early Bird Marathon Reader'],
  [({ speedScore, lengthScore }) => speedScore !== null && speedScore <= 30 && lengthScore > 60, 'Slow Savorer'],
  [({ speedScore, varietyScore }) => speedScore !== null && speedScore > 60 && varietyScore > 60, 'Rapid Explorer'],
  [({ speedScore, rhythmScore }) => speedScore !== null && speedScore > 60 && rhythmScore <= 30, 'Speed Demon'],
  [({ speedScore, varietyScore }) => speedScore !== null && speedScore <= 30 && varietyScore <= 30, 'Patient Specialist'],
  [({ varietyScore }) => varietyScore <= 30, 'Deep Specialist'],
  [({ rhythmScore }) => rhythmScore <= 30, 'Weekend Binge Reader'],
  [({ varietyScore }) => varietyScore > 60, 'Curious Explorer'],
  [({ rhythmScore }) => rhythmScore > 60, 'Steady Habit Reader'],
];

export function computeReadingDna(
  avgPageCount: number,
  uniqueGenres: number,
  totalBooks: number,
  readingDaysRatio: number,
  peakHour: number,
  avgPagesPerHour: number | null,
): ReadingDnaWidgetData {
  const lengthScore = computeLengthScore(avgPageCount);
  const varietyScore = computeVarietyScore(uniqueGenres, totalBooks);
  const rhythmScore = computeRhythmScore(readingDaysRatio);
  const timeScore = computeTimeScore(peakHour);
  const timeLabel = getTimeLabel(peakHour);
  const speedScore = avgPagesPerHour !== null ? computeSpeedScore(avgPagesPerHour) : null;

  let archetype = 'Avid Reader';
  for (const [predicate, label] of ARCHETYPES) {
    if (predicate({ lengthScore, varietyScore, rhythmScore, timeLabel, speedScore })) {
      archetype = label;
      break;
    }
  }

  return {
    archetype,
    lengthScore,
    varietyScore,
    rhythmScore,
    timeScore,
    speedScore: speedScore ?? 0,
    lengthLabel: getLengthLabel(lengthScore),
    varietyLabel: getVarietyLabel(varietyScore),
    rhythmLabel: getRhythmLabel(rhythmScore),
    timeLabel,
    speedLabel: speedScore !== null ? getSpeedLabel(speedScore) : 'N/A',
    booksAnalyzed: totalBooks,
  };
}

// ── Shelf Diversity Score ───────────────────────────────────────────

export function computeGenreBreadth(uniqueGenres: number, totalGenresInLibrary: number): number {
  if (totalGenresInLibrary === 0) return 0;
  return Math.min(100, Math.round((uniqueGenres / totalGenresInLibrary) * 100));
}

export function computeAuthorSpread(uniqueAuthors: number, totalBooksRead: number): number {
  if (totalBooksRead === 0) return 0;
  return Math.min(100, Math.round((uniqueAuthors / totalBooksRead) * 100));
}

export function computeEraRange(publicationYears: number[]): number {
  if (publicationYears.length <= 1) return 0;
  const min = Math.min(...publicationYears);
  const max = Math.max(...publicationYears);
  const span = max - min;
  return Math.min(100, Math.round((span / 100) * 100));
}

export function computeLanguageVariety(uniqueLanguages: number): number {
  return Math.min(100, Math.round((uniqueLanguages / 5) * 100));
}

function getDiversityLabel(score: number): string {
  if (score <= 30) return 'Deep Specialist';
  if (score <= 55) return 'Comfortable Reader';
  if (score <= 75) return 'Curious Explorer';
  return 'Literary Adventurer';
}

export function computeDiversityScore(
  uniqueGenres: number,
  totalGenresInLibrary: number,
  uniqueAuthors: number,
  totalBooksRead: number,
  publicationYears: number[],
  uniqueLanguages: number,
): DiversityScoreWidgetData {
  const genreScore = computeGenreBreadth(uniqueGenres, totalGenresInLibrary);
  const authorScore = computeAuthorSpread(uniqueAuthors, totalBooksRead);
  const eraScore = computeEraRange(publicationYears);
  const languageScore = computeLanguageVariety(uniqueLanguages);

  const score = Math.round((genreScore + authorScore + eraScore + languageScore) / 4);

  return {
    score,
    label: getDiversityLabel(score),
    genreScore,
    authorScore,
    eraScore,
    languageScore,
    booksAnalyzed: totalBooksRead,
  };
}

// ── Reading Rhythm Pulse ────────────────────────────────────────────

export function buildDaysSeries(
  dailyData: { day: string; readingSeconds: number }[],
  today: Date,
  windowDays: number,
): { date: string; readingSeconds: number }[] {
  const lookup = new Map(dailyData.map((d) => [d.day, d.readingSeconds]));
  const result: { date: string; readingSeconds: number }[] = [];

  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    result.push({ date: dateStr, readingSeconds: lookup.get(dateStr) ?? 0 });
  }

  return result;
}

export function computeRhythm(days: { readingSeconds: number }[]): Omit<ReadingRhythmWidgetData, 'days'> {
  const totalDays = days.length;
  if (totalDays === 0) {
    return { consistencyPercent: 0, avgSecondsPerDay: 0, activeDays: 0, totalDays: 0 };
  }

  const activeDays = days.filter((d) => d.readingSeconds > 0).length;
  const totalSeconds = days.reduce((sum, d) => sum + d.readingSeconds, 0);

  return {
    consistencyPercent: Math.round((activeDays / totalDays) * 100),
    avgSecondsPerDay: Math.round(totalSeconds / totalDays),
    activeDays,
    totalDays,
  };
}
