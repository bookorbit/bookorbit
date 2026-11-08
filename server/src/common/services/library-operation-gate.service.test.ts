import { LIBRARY_OPERATION_KINDS, LibraryOperationGate } from './library-operation-gate.service';

describe('LibraryOperationGate', () => {
  let gate: LibraryOperationGate;

  beforeEach(() => {
    gate = new LibraryOperationGate();
  });

  describe.each(LIBRARY_OPERATION_KINDS.flatMap((held) => LIBRARY_OPERATION_KINDS.map((requested) => [held, requested] as const)))(
    'while %s holds a library',
    (held, requested) => {
      it(`refuses ${requested} on that library and allows it on another`, () => {
        const release = gate.tryAcquire(1, held);
        expect(release).not.toBeNull();

        expect(gate.tryAcquire(1, requested)).toBeNull();
        expect(gate.current(1)).toBe(held);

        const other = gate.tryAcquire(2, requested);
        expect(other).not.toBeNull();
        expect(gate.current(2)).toBe(requested);
      });
    },
  );

  it('frees the library on release and ignores a second release', () => {
    const release = gate.tryAcquire(1, 'book_move')!;
    release();
    const next = gate.tryAcquire(1, 'scan');
    expect(next).not.toBeNull();

    release();
    expect(gate.current(1)).toBe('scan');
  });

  it('acquires every library or none', () => {
    const releaseScan = gate.tryAcquire(2, 'scan')!;

    expect(gate.tryAcquireAll([1, 2], 'book_move')).toBeNull();
    expect(gate.current(1)).toBeNull();

    releaseScan();
    const releaseMove = gate.tryAcquireAll([1, 2, 2], 'book_move')!;
    expect(gate.current(1)).toBe('book_move');
    expect(gate.current(2)).toBe('book_move');

    releaseMove();
    expect(gate.isHeld(1)).toBe(false);
    expect(gate.isHeld(2)).toBe(false);
  });

  it('resolves waiters when the holder releases, and at once when the library is free', async () => {
    await expect(gate.whenReleased(1)).resolves.toBeUndefined();

    const release = gate.tryAcquire(1, 'book_merge')!;
    let resolved = false;
    const waiting = gate.whenReleased(1).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    release();
    await waiting;
    expect(resolved).toBe(true);
  });

  it('holds a lease over every library until it is released, and only for its own token', () => {
    const lease = gate.tryAcquireLease([3, 1, 3], 'book_merge')!;
    expect(lease.libraryIds).toEqual([1, 3]);
    expect(lease.holds(1)).toBe(true);
    expect(lease.holds(3)).toBe(true);
    expect(lease.holds(2)).toBe(false);
    expect(gate.tryAcquire(1, 'scan')).toBeNull();
    expect(gate.tryAcquireLease([2, 3], 'book_merge')).toBeNull();

    lease.release();
    expect(lease.holds(1)).toBe(false);
    expect(gate.isHeld(1)).toBe(false);

    const other = gate.tryAcquire(1, 'scan')!;
    expect(lease.holds(1)).toBe(false);
    other();
  });

  it('refuses a lease while any of its libraries is held', () => {
    const release = gate.tryAcquire(2, 'scan')!;

    expect(gate.tryAcquireLease([1, 2], 'book_merge')).toBeNull();
    expect(gate.isHeld(1)).toBe(false);
    release();
  });
});
