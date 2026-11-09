import { AttestationRevocations } from './attestation-revocations';

function statusList(entries: Record<string, { status: string }>) {
  return new Response(JSON.stringify({ entries }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('AttestationRevocations', () => {
  afterEach(() => vi.restoreAllMocks());

  it('finds a revoked or suspended serial however it is written', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(statusList({ '2c8cb9c2': { status: 'REVOKED' }, abc: { status: 'SUSPENDED' } }));
    const revocations = new AttestationRevocations();

    expect(await revocations.anyRevoked(['002C8CB9C2'])).toBe(true);
    expect(await revocations.anyRevoked(['ABC'])).toBe(true);
    expect(await revocations.anyRevoked(['1001'])).toBe(false);
  });

  it('asks Google at most once a day, and shares one request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(statusList({})));
    const revocations = new AttestationRevocations();

    await Promise.all([revocations.anyRevoked(['1'], 0), revocations.anyRevoked(['2'], 0)]);
    await revocations.anyRevoked(['3'], 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    await revocations.anyRevoked(['4'], 24 * 60 * 60_000 + 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last list when Google cannot be reached', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(statusList({ '10': { status: 'REVOKED' } }));
    const revocations = new AttestationRevocations();
    expect(await revocations.anyRevoked(['10'], 0)).toBe(true);

    fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await revocations.anyRevoked(['10'], 24 * 60 * 60_000 + 1)).toBe(true);
    expect(await revocations.anyRevoked(['11'], 24 * 60 * 60_000 + 2)).toBe(false);
  });

  it('lets a registration through when no list was ever fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }));
    expect(await new AttestationRevocations().anyRevoked(['10'])).toBe(false);
  });

  it('never asks for a chain that has nothing to check', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await new AttestationRevocations().anyRevoked([])).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
