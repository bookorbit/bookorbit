import { resolveUserAvatarUrl } from './user-avatar-url';

describe('resolveUserAvatarUrl', () => {
  it('builds versioned API URL for uploaded avatars', () => {
    expect(
      resolveUserAvatarUrl({
        id: 42,
        avatarUrl: 'https://cdn.example/avatar.png',
        avatarSource: 'uploaded',
        avatarVersion: 7,
      }),
    ).toBe('/api/v1/users/42/avatar?v=7');
  });

  it('clamps invalid or negative avatar version to zero for uploaded avatars', () => {
    expect(
      resolveUserAvatarUrl({
        id: 42,
        avatarUrl: null,
        avatarSource: 'uploaded',
        avatarVersion: -10,
      }),
    ).toBe('/api/v1/users/42/avatar?v=0');

    expect(
      resolveUserAvatarUrl({
        id: 42,
        avatarUrl: null,
        avatarSource: 'uploaded',
        avatarVersion: Number.NaN,
      }),
    ).toBe('/api/v1/users/42/avatar?v=0');
  });

  it('returns stored avatarUrl when avatar source is not uploaded', () => {
    expect(
      resolveUserAvatarUrl({
        id: 7,
        avatarUrl: 'https://cdn.example/external.png',
        avatarSource: 'external',
      }),
    ).toBe('https://cdn.example/external.png');
  });
});
