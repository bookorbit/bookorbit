export interface RequestUserPermission {
  id: number;
  name: string;
}

export interface RequestUserRole {
  id: number;
  name: string;
  description: string | null;
  isSuperuser: boolean;
  isSystem: boolean;
  permissions: RequestUserPermission[];
}

export interface RequestUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  active: boolean;
  isDefaultPassword: boolean;
  tokenVersion: number;
  settings: Record<string, unknown>;
  avatarUrl: string | null;
  provisioningMethod: string;
  roles: RequestUserRole[];
}
