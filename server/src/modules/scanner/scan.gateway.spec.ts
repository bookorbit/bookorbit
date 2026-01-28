import { ScanGateway } from './scan.gateway';
import type { BookFileRemovedEvent, BookMissingEvent, CoverRefreshedEvent, CoverRefreshProgressEvent, ScanProgressEvent } from '@projectx/types';

function makeGateway() {
  const gateway = new ScanGateway(
    { verify: jest.fn() } as any,
    { validateUser: jest.fn() } as any,
    { get: jest.fn(), isRunning: jest.fn() } as any,
  );
  return gateway;
}

function mockServer() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { server: { to, emit }, to, emit };
}

// ── book:missing ──────────────────────────────────────────────────────────────

describe('emitBookMissing', () => {
  it('emits book:missing to the correct library room', () => {
    const gateway = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: BookMissingEvent = { libraryId: 7, bookIds: [1, 2, 3] };
    gateway.emitBookMissing(event);

    expect(to).toHaveBeenCalledWith('library:7');
    expect(emit).toHaveBeenCalledWith('book:missing', event);
  });

  it('does not throw when server is undefined (application context)', () => {
    const gateway = makeGateway();
    gateway['server'] = undefined as any;

    expect(() => gateway.emitBookMissing({ libraryId: 1, bookIds: [1] })).not.toThrow();
  });
});

// ── book:file:removed ─────────────────────────────────────────────────────────

describe('emitBookFileRemoved', () => {
  it('emits book:file:removed to the correct library room', () => {
    const gateway = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: BookFileRemovedEvent = { libraryId: 3, bookId: 10, fileId: 55 };
    gateway.emitBookFileRemoved(event);

    expect(to).toHaveBeenCalledWith('library:3');
    expect(emit).toHaveBeenCalledWith('book:file:removed', event);
  });

  it('does not throw when server is undefined', () => {
    const gateway = makeGateway();
    gateway['server'] = undefined as any;

    expect(() => gateway.emitBookFileRemoved({ libraryId: 1, bookId: 1, fileId: 1 })).not.toThrow();
  });
});

// ── pre-existing emit methods (regression) ────────────────────────────────────

describe('emitProgress', () => {
  it('emits scan:progress to the correct room', () => {
    const gateway = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: ScanProgressEvent = {
      jobId: 1, libraryId: 4, status: 'running',
      processed: 10, total: 20, added: 5, updated: 2, missing: 0,
    };
    gateway.emitProgress(event);

    expect(to).toHaveBeenCalledWith('library:4');
    expect(emit).toHaveBeenCalledWith('scan:progress', event);
  });

  it('does not throw when server is undefined', () => {
    const gateway = makeGateway();
    gateway['server'] = undefined as any;

    expect(() =>
      gateway.emitProgress({ jobId: 1, libraryId: 1, status: 'running', processed: 0, total: 0, added: 0, updated: 0, missing: 0 }),
    ).not.toThrow();
  });
});

describe('emitCoverRefreshed', () => {
  it('emits cover:refreshed to the correct room', () => {
    const gateway = makeGateway();
    const { server, to, emit } = mockServer();
    gateway['server'] = server as any;

    const event: CoverRefreshedEvent = { bookId: 9, libraryId: 2 };
    gateway.emitCoverRefreshed(event);

    expect(to).toHaveBeenCalledWith('library:2');
    expect(emit).toHaveBeenCalledWith('cover:refreshed', event);
  });
});
