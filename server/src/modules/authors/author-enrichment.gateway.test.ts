import { AuthorEnrichmentGateway } from './author-enrichment.gateway';

function makeGateway() {
  return new AuthorEnrichmentGateway(
    { verify: vi.fn() } as any,
    { validateUser: vi.fn() } as any,
    { getStatusSummary: vi.fn() } as any,
    { isPaused: vi.fn() } as any,
    { getSnapshot: vi.fn() } as any,
    { get: vi.fn().mockReturnValue('http://localhost:5173') } as any,
  );
}

describe('AuthorEnrichmentGateway', () => {
  it('emitStatus broadcasts to connected sockets', () => {
    const gateway = makeGateway();
    const emit = vi.fn();
    gateway['server'] = { emit } as any;

    gateway.emitStatus({
      queued: 2,
      processing: 1,
      rateLimited: 0,
      failed: 0,
      done: 10,
      total: 13,
    });

    expect(emit).toHaveBeenCalledWith('author-enrichment:status', {
      queued: 2,
      processing: 1,
      rateLimited: 0,
      failed: 0,
      done: 10,
      total: 13,
    });
  });

  it('emitStatus does not throw when server is undefined', () => {
    const gateway = makeGateway();
    gateway['server'] = undefined as any;

    expect(() =>
      gateway.emitStatus({
        queued: 0,
        processing: 0,
        rateLimited: 0,
        failed: 0,
        done: 0,
        total: 0,
      }),
    ).not.toThrow();
  });
});
