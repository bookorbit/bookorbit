import { describe, expect, it, afterEach } from 'vitest';
import { ACHIEVEMENT_CATEGORY_LABELS, localeFromAcceptLanguage, parseAcceptLanguage, type ChallengeType } from '@bookorbit/types';

import { ACHIEVEMENT_SEED } from '../../modules/achievement/seed/achievement-seed';
import { computeChallengeResult } from '../../modules/dashboard/dashboard-widget.calculations';
import { englishCatalog, primeServerTextCatalog, resetServerTextCache, serverText } from './server-text';

const CHALLENGE_TYPES: ChallengeType[] = ['short-read', 'genre-explorer', 'finish-oldest', 'streak-builder', 'new-author', 'page-milestone'];

afterEach(() => resetServerTextCache());

describe('serverText', () => {
  it('returns the English it is given and never looks English up', () => {
    primeServerTextCatalog('en', { achievements: { books_finished_1: { name: 'Something else' } } });

    expect(serverText('en', 'achievements.books_finished_1.name', 'Ink Initiate')).toBe('Ink Initiate');
  });

  it('returns a translation when the language has one', () => {
    primeServerTextCatalog('de', { achievements: { books_finished_1: { name: 'Tinten-Neuling' } } });

    expect(serverText('de', 'achievements.books_finished_1.name', 'Ink Initiate')).toBe('Tinten-Neuling');
  });

  it('falls back to English for a missing, empty or non-string translation', () => {
    primeServerTextCatalog('de', { achievements: { books_finished_1: { name: '  ' }, books_finished_2: 'not a node' } });

    expect(serverText('de', 'achievements.books_finished_1.name', 'Ink Initiate')).toBe('Ink Initiate');
    expect(serverText('de', 'achievements.books_finished_2.name', 'Spine Scout')).toBe('Spine Scout');
    expect(serverText('de', 'achievements.books_finished_3.name', 'Story Stalwart')).toBe('Story Stalwart');
  });
});

describe('the English source catalog', () => {
  // Crowdin translates en.json, but English responses are built from the seed and the constants.
  // If the two drift, translators would be working from text no one sees.
  it('mirrors every seeded achievement', () => {
    const achievements = englishCatalog().achievements as Record<string, { name: string; description: string }>;

    expect(Object.keys(achievements).sort()).toEqual(ACHIEVEMENT_SEED.map((achievement) => achievement.key).sort());
    for (const achievement of ACHIEVEMENT_SEED) {
      expect(achievements[achievement.key]).toEqual({ name: achievement.name, description: achievement.description });
    }
  });

  it('mirrors the category labels, the secret placeholder and the monthly challenges', () => {
    const catalog = englishCatalog();

    expect(catalog.achievementCategories).toEqual(ACHIEVEMENT_CATEGORY_LABELS);
    expect(catalog.achievementSecret).toEqual({ name: 'Secret Achievement', description: 'Keep reading to reveal this achievement.' });
    const challenges = catalog.monthlyChallenge as Record<string, { title: string; description: string }>;
    expect(Object.keys(challenges).sort()).toEqual([...CHALLENGE_TYPES].sort());
    for (const type of CHALLENGE_TYPES) {
      const result = computeChallengeResult(
        type,
        {
          shortBooksCompleted: 0,
          newGenresRead: 0,
          oldestInProgressFinished: false,
          maxStreakThisMonth: 0,
          newAuthorsRead: 0,
          pagesReadThisMonth: 0,
        },
        2026,
        1,
      );
      expect(challenges[type]).toEqual({ title: result.title, description: result.description });
    }
  });
});

describe('Accept-Language', () => {
  it('orders tags by weight and keeps the sent order for equal weights', () => {
    expect(parseAcceptLanguage('fr;q=0.5, de-DE, de;q=0.9, nl')).toEqual(['de-DE', 'nl', 'de', 'fr']);
  });

  it('drops the wildcard and zero weights, and reads a broken weight as 1', () => {
    expect(parseAcceptLanguage('*, fr;q=0, it;q=abc')).toEqual(['it']);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });

  it('resolves what the iOS app and browsers send to a supported locale', () => {
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9')).toBe('de');
    expect(localeFromAcceptLanguage('zh-Hans')).toBe('zh');
    expect(localeFromAcceptLanguage('zh-Hant')).toBe('zh-Hant');
    expect(localeFromAcceptLanguage('zh-TW')).toBe('zh-Hant');
    expect(localeFromAcceptLanguage('pt-BR')).toBe('pt');
    expect(localeFromAcceptLanguage('ca-ES, es;q=0.8')).toBe('es');
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });

  it('names no locale for an unsupported or malformed header', () => {
    expect(localeFromAcceptLanguage('xx-YY')).toBeNull();
    expect(localeFromAcceptLanguage('*')).toBeNull();
    expect(localeFromAcceptLanguage('not a tag!!')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
});
