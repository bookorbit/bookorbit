import type { Mocked } from 'vitest';
import { EMPTY_CONTENT_FILTER_RULES, type DisplayPreferences, type ThemePreferences } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesService } from './user-preferences.service';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 7,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

const validThemePreferences: ThemePreferences = {
  theme: 'dark',
  accent: 'blue',
  radius: 'rounded',
  background: 'vinyl',
  brightness: 35,
};

const validDisplayPreferences: DisplayPreferences = {
  portraitCoverSize: 180,
  squareCoverSize: 160,
  coverSizeScope: 'per-view',
  gridGap: 28,
  portraitGridGap: 24,
  squareGridGap: 20,
  viewMode: 'grid',
  cardOverlays: ['progress-bar', 'format', 'rating'],
  smartScopeFilterExpanded: true,
  authorCoverSize: 140,
  authorCoverShape: 'circle',
  tableZebraStriping: false,
  tableDensity: 'comfortable',
  bookSpineOverlay: 'subtle',
  bookShadowStrength: 'strong',
  bookCoverDisplayMode: 'natural-bottom',
  seriesCardCoverMode: 'mosaic',
  gridCardPrimaryLabel: 'hidden',
  gridCardSecondaryLabel: 'hidden',
};

describe('UserPreferencesController', () => {
  let service: Mocked<UserPreferencesService>;
  let controller: UserPreferencesController;

  beforeEach(() => {
    service = {
      getThemePreferences: vi.fn(),
      getDisplayPreferences: vi.fn(),
      upsertThemePreferences: vi.fn(),
      upsertDisplayPreferences: vi.fn(),
    } as unknown as Mocked<UserPreferencesService>;

    controller = new UserPreferencesController(service);
  });

  it('GET /theme returns null settings when no saved preferences exist', async () => {
    service.getThemePreferences.mockResolvedValueOnce(null);

    await expect(controller.getThemePreferences(makeUser({ id: 11 }))).resolves.toEqual({ settings: null });
    expect(service.getThemePreferences).toHaveBeenCalledWith(11);
  });

  it('GET /theme returns saved settings when present', async () => {
    service.getThemePreferences.mockResolvedValueOnce(validThemePreferences);

    await expect(controller.getThemePreferences(makeUser())).resolves.toEqual({ settings: validThemePreferences });
  });

  it('PUT /theme delegates valid payloads to the service and returns 204', async () => {
    const user = makeUser({ id: 42 });
    const dto = { settings: validThemePreferences };

    await expect(controller.upsertThemePreferences(dto, user)).resolves.toBeUndefined();
    expect(service.upsertThemePreferences).toHaveBeenCalledWith(42, validThemePreferences);
  });

  it('PUT /theme forwards the current user id to the service', async () => {
    const user = makeUser({ id: 99 });

    await controller.upsertThemePreferences({ settings: validThemePreferences }, user);

    expect(service.upsertThemePreferences).toHaveBeenCalledWith(99, validThemePreferences);
  });

  it('GET /display returns null settings when no saved preferences exist', async () => {
    service.getDisplayPreferences.mockResolvedValueOnce(null);

    await expect(controller.getDisplayPreferences(makeUser({ id: 11 }))).resolves.toEqual({ settings: null });
    expect(service.getDisplayPreferences).toHaveBeenCalledWith(11);
  });

  it('GET /display returns saved settings when present', async () => {
    service.getDisplayPreferences.mockResolvedValueOnce(validDisplayPreferences);

    await expect(controller.getDisplayPreferences(makeUser())).resolves.toEqual({ settings: validDisplayPreferences });
  });

  it('PUT /display delegates valid payloads to the service and returns 204', async () => {
    const user = makeUser({ id: 42 });
    const dto = { settings: validDisplayPreferences as unknown as Record<string, unknown> };

    await expect(controller.upsertDisplayPreferences(dto, user)).resolves.toBeUndefined();
    expect(service.upsertDisplayPreferences).toHaveBeenCalledWith(42, validDisplayPreferences);
  });

  it('PUT /display forwards the current user id to the service', async () => {
    const user = makeUser({ id: 99 });

    await controller.upsertDisplayPreferences({ settings: validDisplayPreferences as unknown as Record<string, unknown> }, user);

    expect(service.upsertDisplayPreferences).toHaveBeenCalledWith(99, validDisplayPreferences);
  });
});
