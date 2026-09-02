import { Permission } from '@bookorbit/types';
import type { AuthenticationMethod } from '@bookorbit/types';
import type { ContentFilterRules } from '@bookorbit/types';

export interface RequestUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  active: boolean;
  isSuperuser: boolean;
  isDefaultPassword: boolean;
  tokenVersion: number;
  settings: Record<string, unknown>;
  avatarUrl: string | null;
  avatarSource?: 'none' | 'external' | 'uploaded' | null;
  avatarVersion?: number | null;
  provisioningMethod: string;
  authenticationMethod?: AuthenticationMethod;
  permissions: Permission[];
  contentFilters: ContentFilterRules;
}
