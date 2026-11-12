import { AiJobFailure } from './ai-feature';
import { AiJobChecks, mayRun } from './ai-job-checks.service';
import { createRunnerHarness } from './testing/in-memory-ai-jobs';

function failureOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof AiJobFailure ? error.reason : `unexpected ${String(error)}`),
  );
}

describe('AiJobChecks', () => {
  it('returns the requester and the subject when everything still holds', async () => {
    const h = createRunnerHarness();
    const row = h.job(3);
    const { user, subject } = await new AiJobChecks(h.users).verify(row, h.feature);
    expect(user.id).toBe(row.requestedBy);
    expect(subject.key).toBe(row.subjectKey);
  });

  it('lets a superuser without the permission run', async () => {
    const h = createRunnerHarness();
    const row = h.job();
    h.people.set(row.requestedBy!, { ...h.people.get(row.requestedBy!)!, permissions: [], isSuperuser: true });
    expect(await failureOf(new AiJobChecks(h.users).verify(row, h.feature))).toBeNull();
  });

  it.each([
    ['has no requester', (h: ReturnType<typeof createRunnerHarness>, row: ReturnType<typeof h.job>) => Object.assign(row, { requestedBy: null })],
    ['has a deleted requester', (h: ReturnType<typeof createRunnerHarness>, row: ReturnType<typeof h.job>) => h.people.delete(row.requestedBy!)],
    [
      'has an inactive requester',
      (h: ReturnType<typeof createRunnerHarness>, row: ReturnType<typeof h.job>) =>
        h.people.set(row.requestedBy!, { ...h.people.get(row.requestedBy!)!, active: false }),
    ],
    [
      'has a requester without the permission',
      (h: ReturnType<typeof createRunnerHarness>, row: ReturnType<typeof h.job>) =>
        h.people.set(row.requestedBy!, { ...h.people.get(row.requestedBy!)!, permissions: [] }),
    ],
    ['has a requester who lost the book', (h: ReturnType<typeof createRunnerHarness>) => (h.featureState.reachable = () => false)],
  ])('fails requester when the job %s', async (_label, change) => {
    const h = createRunnerHarness();
    const row = h.job();
    change(h, row);
    expect(await failureOf(new AiJobChecks(h.users).verify(row, h.feature))).toBe('requester');
  });

  it('fails source-changed when the file now has another text', async () => {
    const h = createRunnerHarness();
    const row = h.job();
    h.featureState.subjects.get(String(row.subjectRef.fileId))!.key = 'text-other';
    expect(await failureOf(new AiJobChecks(h.users).verify(row, h.feature))).toBe('source-changed');
  });

  it('passes on the feature failure when the file cannot be read', async () => {
    const h = createRunnerHarness();
    const row = h.job();
    h.featureState.subjects.delete(String(row.subjectRef.fileId));
    expect(await failureOf(new AiJobChecks(h.users).verify(row, h.feature))).toBe('unreadable');
  });
});

describe('mayRun', () => {
  const feature = { permission: 'library.generate' as never };

  it.each([
    [{ active: true, isSuperuser: false, permissions: ['library.generate'] }, true],
    [{ active: true, isSuperuser: true, permissions: [] }, true],
    [{ active: true, isSuperuser: false, permissions: [] }, false],
    [{ active: false, isSuperuser: true, permissions: ['library.generate'] }, false],
  ])('%j may run: %s', (user, expected) => {
    expect(mayRun(user as never, feature)).toBe(expected);
  });
});
