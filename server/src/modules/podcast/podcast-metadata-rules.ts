import { PODCAST_MAX_CATEGORIES } from '@bookorbit/types';
import type { PodcastChapter } from '@bookorbit/types';

export function normalizePodcastCategories(categories: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const category of categories) {
    const value = category.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
    if (normalized.length === PODCAST_MAX_CATEGORIES) break;
  }
  return normalized;
}

export function normalizePodcastChapters(chapters: PodcastChapter[]): PodcastChapter[] {
  return chapters
    .map((chapter) => ({
      title: chapter.title.trim(),
      startSeconds: chapter.startSeconds,
      ...(chapter.endSeconds === undefined ? {} : { endSeconds: chapter.endSeconds }),
      ...(chapter.url ? { url: chapter.url } : {}),
    }))
    .filter((chapter) => chapter.title.length > 0)
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

export function mergePodcastLockedFields<Field extends string>(
  known: readonly Field[],
  current: string[] | null,
  requested: Field[] | undefined,
  editedFields: string[],
): Field[] {
  const requestedOrCurrent = new Set<string>(requested ?? current ?? []);
  for (const field of editedFields) requestedOrCurrent.add(field);
  return known.filter((field) => requestedOrCurrent.has(field));
}
