export interface Permission {
  id: number
  name: string
  description?: string
  isSystem: boolean
}

export interface Role {
  id: number
  name: string
  description?: string
  isSuperuser: boolean
  isSystem: boolean
  permissions: Permission[]
}

export interface AuthUser {
  id: number
  username: string
  name: string
  email?: string
  active: boolean
  isDefaultPassword: boolean
  settings: Record<string, unknown>
  avatarUrl?: string | null
  provisioningMethod: 'local' | 'oidc'
  roles: Role[]
  permissions: string[] // flat list; '*' means superuser
}

export interface OidcPublicConfig {
  enabled: boolean
  providerName: string
  issuerUri: string
  clientId: string
  scopes: string
}

export interface AuthResponse {
  accessToken: string
  user: AuthUser
}

export interface RefreshResponse {
  accessToken: string
}

export interface Session {
  id: number
  createdAt: string
  expiresAt: string
}
