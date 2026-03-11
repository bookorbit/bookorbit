import { OidcClaimExtractorService } from './oidc-claim-extractor.service';
import type { ClaimMapping } from './oidc-claim-extractor.service';

const defaultMapping: ClaimMapping = {
  username: 'preferred_username',
  name: 'name',
  email: 'email',
  groups: 'groups',
};

describe('OidcClaimExtractorService', () => {
  let service: OidcClaimExtractorService;

  beforeEach(() => {
    service = new OidcClaimExtractorService();
  });

  it('extracts standard claims from ID token', () => {
    const idToken = {
      sub: 'user-123',
      preferred_username: 'jdoe',
      name: 'John Doe',
      email: 'jdoe@example.com',
      groups: ['admins', 'users'],
    };

    const result = service.extract(idToken, {}, defaultMapping);

    expect(result.subject).toBe('user-123');
    expect(result.username).toBe('jdoe');
    expect(result.name).toBe('John Doe');
    expect(result.email).toBe('jdoe@example.com');
    expect(result.groups).toEqual(['admins', 'users']);
  });

  it('userInfo claims override ID token claims', () => {
    const idToken = { sub: 'u1', preferred_username: 'old-username', name: 'Old Name', email: 'old@example.com' };
    const userInfo = { preferred_username: 'new-username', name: 'New Name', email: 'new@example.com' };

    const result = service.extract(idToken, userInfo, defaultMapping);

    expect(result.username).toBe('new-username');
    expect(result.name).toBe('New Name');
    expect(result.email).toBe('new@example.com');
  });

  it('falls back username to email if preferred_username missing', () => {
    const idToken = { sub: 'u1', email: 'fallback@example.com' };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.username).toBe('fallback@example.com');
  });

  it('falls back username to sub if both preferred_username and email are missing', () => {
    const idToken = { sub: 'sub-only-user' };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.username).toBe('sub-only-user');
  });

  it('falls back name to username if name claim is missing', () => {
    const idToken = { sub: 'u1', preferred_username: 'jdoe' };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.name).toBe('jdoe');
  });

  it('extracts avatarUrl from picture claim', () => {
    const idToken = { sub: 'u1', picture: 'https://example.com/avatar.jpg' };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.avatarUrl).toBe('https://example.com/avatar.jpg');
  });

  it('returns undefined avatarUrl when picture is not a string', () => {
    const idToken = { sub: 'u1', picture: 42 };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.avatarUrl).toBeUndefined();
  });

  it('returns empty groups array when groups claim is absent', () => {
    const idToken = { sub: 'u1' };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.groups).toEqual([]);
  });

  it('returns empty groups when groups claim is not an array', () => {
    const idToken = { sub: 'u1', groups: 'admins' };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.groups).toEqual([]);
  });

  it('converts non-string group entries to strings', () => {
    const idToken = { sub: 'u1', groups: [1, 'editors', true] };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.groups).toEqual(['1', 'editors', 'true']);
  });

  it('returns undefined email when email claim is not a string', () => {
    const idToken = { sub: 'u1', email: 123 };
    const result = service.extract(idToken, {}, defaultMapping);
    expect(result.email).toBeUndefined();
  });

  it('uses custom claim mapping', () => {
    const customMapping: ClaimMapping = {
      username: 'login',
      name: 'display_name',
      email: 'mail',
      groups: 'cognito:groups',
    };
    const idToken = {
      sub: 'u1',
      login: 'custom-user',
      display_name: 'Custom User',
      mail: 'custom@example.com',
      'cognito:groups': ['group-a'],
    };

    const result = service.extract(idToken, {}, customMapping);
    expect(result.username).toBe('custom-user');
    expect(result.name).toBe('Custom User');
    expect(result.email).toBe('custom@example.com');
    expect(result.groups).toEqual(['group-a']);
  });

  it('returns empty subject string when sub is missing', () => {
    const result = service.extract({}, {}, defaultMapping);
    expect(result.subject).toBe('');
  });
});
