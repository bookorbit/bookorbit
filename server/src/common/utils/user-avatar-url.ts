type AvatarUserState = {
  id: number;
  avatarUrl: string | null;
  avatarSource?: 'none' | 'external' | 'uploaded' | null;
  avatarVersion?: number | null;
};

export function resolveUserAvatarUrl(user: AvatarUserState): string | null {
  if (user.avatarSource === 'uploaded') {
    const version = Number.isFinite(user.avatarVersion) ? Math.max(0, Number(user.avatarVersion)) : 0;
    return `/api/v1/users/${user.id}/avatar?v=${version}`;
  }
  return user.avatarUrl;
}
