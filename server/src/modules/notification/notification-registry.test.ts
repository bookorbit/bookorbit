import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_TYPE_META,
  NotificationLevel,
  NotificationType,
  availableLevelsForCategory,
  categorySupportsProblemsLevel,
  isNotificationAllowed,
  resolveNotificationLevel,
} from '@bookorbit/types';

describe('notification registry', () => {
  it('gives every declared type a category and a severity', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_TYPE_META[type], `missing meta for ${type}`).toBeDefined();
      expect(NOTIFICATION_CATEGORY_IDS).toContain(NOTIFICATION_TYPE_META[type].category);
    }
  });

  it('puts every type in exactly one category bucket', () => {
    const bucketed = NOTIFICATION_CATEGORY_IDS.flatMap((category) => [...NOTIFICATION_CATEGORIES[category]]);
    expect(bucketed.sort()).toEqual(Object.values(NotificationType).sort());
  });

  it('leaves no category empty', () => {
    for (const category of NOTIFICATION_CATEGORY_IDS) {
      expect(NOTIFICATION_CATEGORIES[category].length, `${category} has no types`).toBeGreaterThan(0);
    }
  });
});

describe('levels', () => {
  it('maps the legacy boolean shape so stored preferences need no migration', () => {
    expect(resolveNotificationLevel(false)).toBe(NotificationLevel.Off);
    expect(resolveNotificationLevel(true)).toBe(NotificationLevel.All);
    expect(resolveNotificationLevel(undefined)).toBe(NotificationLevel.All);
    expect(resolveNotificationLevel('problems')).toBe(NotificationLevel.Problems);
    expect(resolveNotificationLevel('nonsense')).toBe(NotificationLevel.All);
  });

  it('admits warnings as well as errors at the problems level', () => {
    expect(isNotificationAllowed(NotificationLevel.Problems, 'error')).toBe(true);
    expect(isNotificationAllowed(NotificationLevel.Problems, 'warning')).toBe(true);
    expect(isNotificationAllowed(NotificationLevel.Problems, 'success')).toBe(false);
  });

  it('passes everything at all and nothing at off', () => {
    for (const severity of ['success', 'warning', 'error'] as const) {
      expect(isNotificationAllowed(NotificationLevel.All, severity)).toBe(true);
      expect(isNotificationAllowed(NotificationLevel.Off, severity)).toBe(false);
    }
  });
});

describe('degenerate categories', () => {
  it('offers the problems level only where a warning or error type exists', () => {
    expect(categorySupportsProblemsLevel('scanning')).toBe(true);
    expect(categorySupportsProblemsLevel('achievements')).toBe(false);
    expect(categorySupportsProblemsLevel('bookDock')).toBe(true);
  });

  it('never offers a level that would behave identically to off', () => {
    for (const category of NOTIFICATION_CATEGORY_IDS) {
      const levels = availableLevelsForCategory(category);
      const hasProblem = NOTIFICATION_CATEGORIES[category].some((type) => ['warning', 'error'].includes(NOTIFICATION_TYPE_META[type].severity));
      expect(levels.includes(NotificationLevel.Problems)).toBe(hasProblem);
      expect(levels).toContain(NotificationLevel.Off);
      expect(levels).toContain(NotificationLevel.All);
    }
  });
});
