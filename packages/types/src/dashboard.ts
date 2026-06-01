export const SCROLLER_TYPE = {
  RECENTLY_ADDED: "recently-added",
  CONTINUE_READING: "continue-reading",
  UP_NEXT_IN_SERIES: "up-next-in-series",
  RANDOM: "random",
  SMART_SCOPE: "smart-scope",
} as const;

export type ScrollerType = (typeof SCROLLER_TYPE)[keyof typeof SCROLLER_TYPE];
export const SCROLLER_TYPES = Object.values(SCROLLER_TYPE) as ReadonlyArray<ScrollerType>;

export interface ScrollerConfig {
  id: string;
  type: ScrollerType;
  label: string;
  enabled: boolean;
  order: number;
  limit: number;
  smartScopeId?: number;
}

export const WIDGET_TYPE = {
  READING_STREAK: "reading-streak",
  CURRENTLY_READING: "currently-reading",
  READING_GOAL: "reading-goal",
  READING_DNA: "reading-dna",
  MONTHLY_CHALLENGE: "monthly-challenge",
  HIGHLIGHT_OF_THE_DAY: "highlight-of-the-day",
  NEGLECTED_GEMS: "neglected-gems",
  READING_RHYTHM: "reading-rhythm",
  DIVERSITY_SCORE: "diversity-score",
  LIBRARY_OVERVIEW: "library-overview",
  YEAR_PROJECTION: "year-projection",
  LONG_WAIT: "long-wait",
} as const;

export type WidgetType = (typeof WIDGET_TYPE)[keyof typeof WIDGET_TYPE];
export const WIDGET_TYPES = Object.values(WIDGET_TYPE) as ReadonlyArray<WidgetType>;

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  enabled: boolean;
  order: number;
}

export interface DashboardConfig {
  readingGoal?: number;
  widgets?: WidgetConfig[];
}

export interface ReadingGoalWidgetData {
  goalBooks: number | null;
  completedBooks: number;
  year: number;
}

export interface CurrentlyReadingBook {
  bookId: number;
  title: string | null;
  authors: string[];
  progress: number;
  hasCover: boolean;
  fileId: number | null;
  fileFormat: string | null;
}

export interface CurrentlyReadingWidgetData {
  books: CurrentlyReadingBook[];
}

export interface ReadingStreakWidgetData {
  currentStreak: number;
  longestStreak: number;
  lastSevenDays: boolean[];
}

export interface LibraryOverviewWidgetData {
  totalBooks: number;
  totalAuthors: number;
  totalSeries: number;
  totalStorageBytes: number;
  booksAddedThisYear: number;
}

export interface HighlightOfTheDayWidgetData {
  text: string;
  note: string | null;
  bookTitle: string | null;
  bookId: number;
  hasCover: boolean;
  chapterTitle: string | null;
  createdAt: string;
}

export type ChallengeType = "short-read" | "genre-explorer" | "finish-oldest" | "streak-builder" | "new-author" | "page-milestone";

export interface MonthlyChallengeWidgetData {
  challengeType: ChallengeType;
  title: string;
  description: string;
  progress: number;
  target: number;
  completed: boolean;
  month: number;
  year: number;
}

export interface YearProjectionWidgetData {
  projectedBooks: number;
  projectedPages: number;
  projectedHours: number;
  booksCompletedYtd: number;
  daysRemaining: number;
  trend: "up" | "down" | "stable";
}

export interface NeglectedGem {
  bookId: number;
  title: string | null;
  hasCover: boolean;
  rating: number;
  waitingDays: number;
  genre: string | null;
}

export interface NeglectedGemsWidgetData {
  gems: NeglectedGem[];
}

export interface ReadingDnaWidgetData {
  archetype: string;
  lengthScore: number;
  varietyScore: number;
  rhythmScore: number;
  timeScore: number;
  speedScore: number;
  lengthLabel: string;
  varietyLabel: string;
  rhythmLabel: string;
  timeLabel: string;
  speedLabel: string;
  booksAnalyzed: number;
}

export interface LongWaitWidgetData {
  bookId: number;
  title: string | null;
  hasCover: boolean;
  addedAt: string;
  waitingDays: number;
  pageCount: number | null;
  genre: string | null;
  fileId: number | null;
  fileFormat: string | null;
}

export interface DiversityScoreWidgetData {
  score: number;
  label: string;
  genreScore: number;
  authorScore: number;
  eraScore: number;
  languageScore: number;
  booksAnalyzed: number;
}

export interface ReadingRhythmDay {
  date: string;
  readingSeconds: number;
}

export interface ReadingRhythmWidgetData {
  days: ReadingRhythmDay[];
  consistencyPercent: number;
  avgSecondsPerDay: number;
  activeDays: number;
  totalDays: number;
}
