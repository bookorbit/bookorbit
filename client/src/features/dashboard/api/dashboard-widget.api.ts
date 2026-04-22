import type {
  CurrentlyReadingWidgetData,
  DiversityScoreWidgetData,
  HighlightOfTheDayWidgetData,
  LibraryOverviewWidgetData,
  LongWaitWidgetData,
  MonthlyChallengeWidgetData,
  NeglectedGemsWidgetData,
  ReadingDnaWidgetData,
  ReadingGoalWidgetData,
  ReadingRhythmWidgetData,
  ReadingStreakWidgetData,
  YearProjectionWidgetData,
} from '@bookorbit/types'
import { api } from '@/lib/api'

export async function fetchReadingGoal(): Promise<ReadingGoalWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/reading-goal')
  if (!res.ok) throw new Error('Failed to fetch reading goal')
  return res.json()
}

export async function fetchCurrentlyReading(): Promise<CurrentlyReadingWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/currently-reading')
  if (!res.ok) throw new Error('Failed to fetch currently reading')
  return res.json()
}

export async function fetchReadingStreak(): Promise<ReadingStreakWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/reading-streak')
  if (!res.ok) throw new Error('Failed to fetch reading streak')
  return res.json()
}

export async function fetchLibraryOverview(): Promise<LibraryOverviewWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/library-overview')
  if (!res.ok) throw new Error('Failed to fetch library overview')
  return res.json()
}

export async function fetchHighlightOfTheDay(): Promise<HighlightOfTheDayWidgetData | null> {
  const res = await api('/api/v1/dashboard/widgets/highlight-of-the-day')
  if (!res.ok) throw new Error('Failed to fetch highlight of the day')
  return res.json()
}

export async function fetchMonthlyChallenge(): Promise<MonthlyChallengeWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/monthly-challenge')
  if (!res.ok) throw new Error('Failed to fetch monthly challenge')
  return res.json()
}

export async function fetchYearProjection(): Promise<YearProjectionWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/year-projection')
  if (!res.ok) throw new Error('Failed to fetch year projection')
  return res.json()
}

export async function fetchNeglectedGems(): Promise<NeglectedGemsWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/neglected-gems')
  if (!res.ok) throw new Error('Failed to fetch neglected gems')
  return res.json()
}

export async function fetchReadingDna(): Promise<ReadingDnaWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/reading-dna')
  if (!res.ok) throw new Error('Failed to fetch reading DNA')
  return res.json()
}

export async function fetchLongWait(): Promise<LongWaitWidgetData | null> {
  const res = await api('/api/v1/dashboard/widgets/long-wait')
  if (!res.ok) throw new Error('Failed to fetch long wait')
  return res.json()
}

export async function fetchDiversityScore(): Promise<DiversityScoreWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/diversity-score')
  if (!res.ok) throw new Error('Failed to fetch diversity score')
  return res.json()
}

export async function fetchReadingRhythm(): Promise<ReadingRhythmWidgetData> {
  const res = await api('/api/v1/dashboard/widgets/reading-rhythm')
  if (!res.ok) throw new Error('Failed to fetch reading rhythm')
  return res.json()
}
