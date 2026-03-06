import { OidcStateService } from './oidc-state.service';

describe('OidcStateService', () => {
  let service: OidcStateService;

  beforeEach(() => {
    service = new OidcStateService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('generate', () => {
    it('returns a non-empty base64url string', () => {
      const state = service.generate();
      expect(typeof state).toBe('string');
      expect(state.length).toBeGreaterThan(0);
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('returns unique values on each call', () => {
      const a = service.generate();
      const b = service.generate();
      expect(a).not.toBe(b);
    });

    it('prunes expired states on generate', () => {
      const state = service.generate();
      // Advance past TTL (5 minutes)
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);

      // generate() triggers pruning
      service.generate();

      // The original state should now be expired and validateAndConsume returns false
      expect(service.validateAndConsume(state)).toBe(false);
    });
  });

  describe('validateAndConsume', () => {
    it('returns true for a valid, fresh state', () => {
      const state = service.generate();
      expect(service.validateAndConsume(state)).toBe(true);
    });

    it('returns false on second use (one-time use)', () => {
      const state = service.generate();
      service.validateAndConsume(state);
      expect(service.validateAndConsume(state)).toBe(false);
    });

    it('returns false for unknown state', () => {
      expect(service.validateAndConsume('totally-fake-state')).toBe(false);
    });

    it('returns false for expired state', () => {
      const state = service.generate();
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(service.validateAndConsume(state)).toBe(false);
    });

    it('returns true at exactly TTL boundary', () => {
      const state = service.generate();
      jest.advanceTimersByTime(5 * 60 * 1000);
      // At exactly TTL, Date.now() - ts === TTL, which is NOT > TTL, so still valid
      expect(service.validateAndConsume(state)).toBe(true);
    });
  });
});
