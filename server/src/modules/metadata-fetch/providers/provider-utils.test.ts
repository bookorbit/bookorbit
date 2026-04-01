import { buildRequestSignal, normalizeMaxCandidates, sleep, stripHtml } from './provider-utils';

describe('provider-utils', () => {
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
});
