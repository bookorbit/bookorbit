import { Permission } from '@projectx/types';

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
  provisioningMethod: string;
  permissions: Permission[];
}
