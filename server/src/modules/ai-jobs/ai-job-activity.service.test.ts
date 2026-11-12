import { AiJobActivityService } from './ai-job-activity.service';

function makeActivity() {
  const events = { append: vi.fn(() => Promise.resolve()), list: vi.fn(() => Promise.resolve([])) };
  return { events, activity: new AiJobActivityService(events as never) };
}

describe('AiJobActivityService', () => {
  it('appends one bounded entry', async () => {
    const { events, activity } = makeActivity();
    await activity.record('job-1', 'info', 'names', 'step_finished', { done: 3, ok: true, note: null });
    expect(events.append).toHaveBeenCalledWith([
      { jobId: 'job-1', level: 'info', step: 'names', code: 'step_finished', data: { done: 3, ok: true, note: null } },
    ]);
  });

  it('keeps codes, keys and text short and every value on one line', async () => {
    const { events, activity } = makeActivity();
    const data = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index]));
    await activity.record('job-1', 'warn', null, 'c'.repeat(80), { ...data, k0: `line one\nline\u0007two${'x'.repeat(400)}` });
    const [[[entry]]] = events.append.mock.calls as unknown as [[[{ code: string; data: Record<string, unknown> }]]];
    expect(entry.code).toHaveLength(60);
    expect(Object.keys(entry.data)).toHaveLength(20);
    expect(entry.data.k0).toMatch(/^line one line two/);
    expect(entry.data.k0).toHaveLength(300);
  });

  it('stores no data when none is given', async () => {
    const { events, activity } = makeActivity();
    await activity.record('job-1', 'info', null, 'claimed');
    expect(events.append).toHaveBeenCalledWith([expect.objectContaining({ data: null })]);
  });

  it('never fails the job it describes', async () => {
    const { events, activity } = makeActivity();
    events.append.mockRejectedValueOnce(new Error('database down'));
    await expect(activity.record('job-1', 'info', null, 'claimed')).resolves.toBeUndefined();
  });

  it('lists through the repository', async () => {
    const { events, activity } = makeActivity();
    await activity.list('job-1', 42);
    expect(events.list).toHaveBeenCalledWith('job-1', 42);
  });
});
