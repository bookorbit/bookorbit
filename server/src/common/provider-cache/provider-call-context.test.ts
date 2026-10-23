import {
  currentProviderCallRecord,
  markProviderDegraded,
  ProviderCallRecord,
  providerRequestKey,
  recordAuxiliaryProviderRequest,
  recordProviderRequest,
  recordProviderRequestError,
  runWithProviderCallRecord,
} from './provider-call-context';

describe('provider call context', () => {
  it('keeps only the final outcome of a retried request', () => {
    const record = new ProviderCallRecord();
    record.recordRequest('GET a', { kind: 'status', status: 503 });
    record.recordRequest('GET a', { kind: 'status', status: 200 });

    expect(record.mainRequests).toBe(1);
    expect(record.outboundRequests).toBe(2);
    expect(record.unsuccessfulRequests()).toEqual([]);
  });

  it('treats declared statuses as answers and everything else as failures', () => {
    const record = new ProviderCallRecord();
    record.recordRequest('GET a', { kind: 'status', status: 404 });
    record.recordRequest('GET b', { kind: 'error', errorClass: 'TypeError' });
    record.recordRequest('GET c', { kind: 'aborted' });

    expect(record.unsuccessfulRequests([404])).toHaveLength(2);
    expect(record.unsuccessfulRequests()).toHaveLength(3);
  });

  it('counts a status the provider accepts for that request as a normal answer', () => {
    const record = new ProviderCallRecord();
    record.recordRequest('GET chapters', { kind: 'status', status: 404, accepted: true });

    expect(record.unsuccessfulRequests()).toEqual([]);
  });

  it('distinguishes requests by method and body', () => {
    expect(providerRequestKey('https://x.test/graphql', { method: 'post', body: '{"q":1}' })).not.toBe(
      providerRequestKey('https://x.test/graphql', { method: 'POST', body: '{"q":2}' }),
    );
  });

  it('records aborts and transport errors separately', () => {
    const record = new ProviderCallRecord();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    return runWithProviderCallRecord(record, () => {
      recordProviderRequestError('GET a', abort);
      recordProviderRequestError('GET b', new TypeError('fetch failed'));
      return Promise.resolve();
    }).then(() => {
      expect(record.unsuccessfulRequests()).toEqual([{ kind: 'aborted' }, { kind: 'error', errorClass: 'TypeError' }]);
    });
  });

  it('isolates concurrent operations and ignores calls outside any operation', async () => {
    const first = new ProviderCallRecord();
    const second = new ProviderCallRecord();
    recordProviderRequest('GET outside', { kind: 'status', status: 200 });

    await Promise.all([
      runWithProviderCallRecord(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        recordProviderRequest('GET first', { kind: 'status', status: 200 });
      }),
      runWithProviderCallRecord(second, async () => {
        markProviderDegraded('challenge');
        recordAuxiliaryProviderRequest(false);
        expect(currentProviderCallRecord()).toBe(second);
        await Promise.resolve();
      }),
    ]);

    expect(first.mainRequests).toBe(1);
    expect(first.degradationReasons).toEqual([]);
    expect(second.mainRequests).toBe(0);
    expect(second.degradationReasons).toEqual(['challenge']);
    expect(second.auxiliaryAllDefinitive).toBe(false);
    expect(currentProviderCallRecord()).toBeUndefined();
  });
});
