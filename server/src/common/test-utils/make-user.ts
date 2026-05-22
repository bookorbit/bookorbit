import type { RequestUser } from '../types/request-user';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

export function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    avatarSource: 'none',
    avatarVersion: 0,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  };
}
