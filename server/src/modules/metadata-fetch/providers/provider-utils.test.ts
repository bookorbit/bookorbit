import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { ProviderThrottleError } from '../provider-throttle.error';
import {
  allowsAudiobookProviders,
  buildRequestSignal,
  normalizeMaxCandidates,
  rethrowWithPartialCandidates,
  sleep,
  stripHtml,
} from './provider-utils';

function candidate(providerId: string): MetadataCandidate {
  return { provider: MetadataProviderKey.GOODREADS, providerId, title: `Book ${providerId}` };
}

describe('provider-utils', () => {
  describe('allowsAudiobookProviders', () => {
    it('follows the media type when the caller states no preference', () => {
      expect(allowsAudiobookProviders({ isAudiobook: true })).toBe(true);
      expect(allowsAudiobookProviders({ isAudiobook: false })).toBe(false);
      expect(allowsAudiobookProviders({})).toBe(false);
    });

    it('runs audiobook providers for an ebook when they were asked for explicitly', () => {
      expect(allowsAudiobookProviders({ isAudiobook: false, includeAudiobookProviders: true })).toBe(true);
      expect(allowsAudiobookProviders({ isAudiobook: true, includeAudiobookProviders: false })).toBe(false);
    });
  });

  describe('normalizeMaxCandidates', () => {
    it('returns max when value is missing or invalid', () => {
      expect(normalizeMaxCandidates(undefined, 10)).toBe(10);
      expect(normalizeMaxCandidates(Number.NaN, 10)).toBe(10);
    });

    it('clamps to [1, max]', () => {
      expect(normalizeMaxCandidates(0, 10)).toBe(1);
      expect(normalizeMaxCandidates(1.9, 10)).toBe(1);
      expect(normalizeMaxCandidates(4.2, 10)).toBe(4);
      expect(normalizeMaxCandidates(99, 10)).toBe(10);
    });
  });

  describe('sleep', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves after the requested delay', async () => {
      vi.useFakeTimers();

      const promise = sleep(100);
      await vi.advanceTimersByTimeAsync(99);
      let settled = false;
      void promise.then(() => {
        settled = true;
      });
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects with AbortError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(sleep(100, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });

  describe('stripHtml', () => {
    it('removes tags, decodes supported entities, and normalizes whitespace', () => {
      const value = stripHtml('<p>Hello &amp; <strong>world</strong> &#39;reader&#39;</p>');
      expect(value).toBe("Hello & world 'reader'");
    });
  });

  describe('buildRequestSignal', () => {
    it('returns a signal that aborts when parent signal aborts', () => {
      const controller = new AbortController();
      const signal = buildRequestSignal(10_000, controller.signal);

      controller.abort();

      expect(signal.aborted).toBe(true);
    });
  });

  describe('rethrowWithPartialCandidates', () => {
    it('carries the candidates gathered before the throttle, keeping the retry-after and reason', () => {
      const gathered = [candidate('1'), candidate('2')];

      try {
        rethrowWithPartialCandidates(new ProviderThrottleError(30, 'bot challenge'), gathered);
        expect.unreachable('should have rethrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderThrottleError);
        const throttle = err as ProviderThrottleError;
        expect(throttle.partialCandidates).toEqual(gathered);
        expect(throttle.retryAfterSeconds).toBe(30);
        expect(throttle.message).toBe('Provider throttled (bot challenge)');
      }
    });

    it('snapshots the candidates so a later push cannot change what was salvaged', () => {
      const gathered = [candidate('1')];

      try {
        rethrowWithPartialCandidates(new ProviderThrottleError(), gathered);
        expect.unreachable('should have rethrown');
      } catch (err) {
        gathered.push(candidate('2'));
        expect((err as ProviderThrottleError).partialCandidates).toHaveLength(1);
      }
    });

    it('leaves candidates attached by an inner loop alone', () => {
      const inner = [candidate('inner')];
      const original = new ProviderThrottleError(undefined, 'HTTP 429', inner);

      expect(() => rethrowWithPartialCandidates(original, [candidate('outer')])).toThrow(original);
    });

    it('rethrows anything that is not a throttle untouched', () => {
      const failure = new Error('bad upstream response');

      expect(() => rethrowWithPartialCandidates(failure, [candidate('1')])).toThrow(failure);
    });

    it('rethrows the original throttle when nothing was gathered', () => {
      const original = new ProviderThrottleError(30);

      expect(() => rethrowWithPartialCandidates(original, [])).toThrow(original);
    });
  });
});
