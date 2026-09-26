import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { validatePodcastScopeRules } from './podcast-scope-rules.validator';

describe('validatePodcastScopeRules', () => {
  it('treats an absent rule set as no rules', () => {
    expect(validatePodcastScopeRules(null)).toBeNull();
    expect(validatePodcastScopeRules(undefined)).toBeNull();
  });

  it('fills defaults so a partial rule set still evaluates', () => {
    expect(validatePodcastScopeRules({})).toEqual({
      filter: 'latest',
      sort: 'newest',
      minDurationMinutes: null,
      maxDurationMinutes: null,
      publishedWithinDays: null,
      podcastIds: [],
      followedOnly: false,
    });
  });

  it('accepts the pinned filter the playlist preferences schema rejected', () => {
    expect(validatePodcastScopeRules({ filter: 'pinned' })?.filter).toBe('pinned');
  });

  it.each(['latest', 'downloaded', 'in_progress', 'unplayed', 'finished', 'pinned'])('accepts the %s filter', (filter) => {
    expect(validatePodcastScopeRules({ filter })?.filter).toBe(filter);
  });

  it.each(['newest', 'oldest', 'shortest', 'longest', 'recently_listened'])('accepts the %s sort', (sort) => {
    expect(validatePodcastScopeRules({ sort })?.sort).toBe(sort);
  });

  it('rejects an unknown filter or sort rather than silently matching everything', () => {
    expect(() => validatePodcastScopeRules({ filter: 'archived' })).toThrow(BadRequestException);
    expect(() => validatePodcastScopeRules({ sort: 'alphabetical' })).toThrow(BadRequestException);
  });

  it('rejects a rule set that is not an object', () => {
    expect(() => validatePodcastScopeRules('unplayed')).toThrow(BadRequestException);
    expect(() => validatePodcastScopeRules([])).toThrow(BadRequestException);
  });

  it('rejects a duration range that can never match', () => {
    expect(() => validatePodcastScopeRules({ minDurationMinutes: 60, maxDurationMinutes: 20 })).toThrow(BadRequestException);
    expect(validatePodcastScopeRules({ minDurationMinutes: 20, maxDurationMinutes: 60 })?.minDurationMinutes).toBe(20);
  });

  it.each([0, -1, 1.5, 'ten'])('rejects the non-positive-integer duration %s', (value) => {
    expect(() => validatePodcastScopeRules({ minDurationMinutes: value })).toThrow(BadRequestException);
  });

  it('bounds how many shows a scope can target', () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => index + 1);
    expect(() => validatePodcastScopeRules({ podcastIds: tooMany })).toThrow(BadRequestException);
  });

  it('rejects show ids that are not positive integers', () => {
    expect(() => validatePodcastScopeRules({ podcastIds: [1, 0] })).toThrow(BadRequestException);
    expect(() => validatePodcastScopeRules({ podcastIds: ['3'] })).toThrow(BadRequestException);
    expect(() => validatePodcastScopeRules({ podcastIds: 4 })).toThrow(BadRequestException);
  });

  it('drops duplicate show ids so a scope cannot double-count a show', () => {
    expect(validatePodcastScopeRules({ podcastIds: [3, 3, 5] })?.podcastIds).toEqual([3, 5]);
  });

  it('rejects a non-boolean followedOnly', () => {
    expect(() => validatePodcastScopeRules({ followedOnly: 'yes' })).toThrow(BadRequestException);
    expect(validatePodcastScopeRules({ followedOnly: true })?.followedOnly).toBe(true);
  });
});
