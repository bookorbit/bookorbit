import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReadAloudPublisher } from './read-aloud-publisher.service';
import { ReadAloudWorkspace } from './read-aloud-workspace.service';
import { ADMIN, DELETER, JOB_ID, jobRow, OWNER } from './test-helpers';

function setup(workRoot = '/data/read-aloud/jobs') {
  const jobs = {
    findReadAlongFiles: vi.fn().mockResolvedValue([{ fileId: 300, filename: 'novel.readaloud.epub', sizeBytes: 1, generatedByJobId: null }]),
    findSourceFiles: vi.fn().mockResolvedValue([{ id: 101, filename: 'novel.epub' }]),
    saveReportChapters: vi.fn().mockResolvedValue(undefined),
  };
  const files = {
    replaceFile: vi.fn().mockResolvedValue({ fileId: 300 }),
    addFile: vi.fn().mockResolvedValue({ fileId: 900, reused: false }),
  };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  const workspace = new ReadAloudWorkspace({ workRoot } as never);
  const publisher = new ReadAloudPublisher({ maxOutputBytes: 1e9 } as never, jobs as never, workspace, files as never, activity as never);
  return { publisher, jobs, files, activity };
}

describe('ReadAloudPublisher.publish', () => {
  const row = jobRow({ status: 'processing', stage: 'publishing', replaceFileId: 300 });

  it.each([
    ['a requester who may delete books', DELETER],
    ['a superuser', ADMIN],
  ])('replaces the chosen read-along for %s', async (_label, user) => {
    const { publisher, files } = setup();
    await expect(publisher.publish(row, user)).resolves.toBe(300);
    expect(files.replaceFile).toHaveBeenCalledWith(expect.objectContaining({ fileId: 300, bookId: 12 }));
    expect(files.addFile).not.toHaveBeenCalled();
  });

  it('adds a new file instead when whoever publishes may no longer delete books', async () => {
    const { publisher, files, activity } = setup();
    await expect(publisher.publish(row, OWNER)).resolves.toBe(900);
    expect(files.replaceFile).not.toHaveBeenCalled();
    expect(files.addFile).toHaveBeenCalledWith(expect.objectContaining({ filename: 'novel.readaloud.epub' }));
    expect(activity.record).toHaveBeenCalledWith(JOB_ID, 'warn', 'publishing', 'replace_not_permitted', expect.any(String));
  });

  it('adds a new file when the read-along chosen for replacement is gone', async () => {
    const { publisher, jobs, files, activity } = setup();
    jobs.findReadAlongFiles.mockResolvedValue([]);
    await expect(publisher.publish(row, DELETER)).resolves.toBe(900);
    expect(files.replaceFile).not.toHaveBeenCalled();
    expect(activity.record).toHaveBeenCalledWith(JOB_ID, 'warn', 'publishing', 'replace_target_missing', expect.any(String));
  });
});

describe('ReadAloudPublisher.validate', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'read-aloud-publish-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses an output the worker left as a link to another file', async () => {
    const { publisher } = setup(root);
    const elsewhere = join(root, 'another-library.epub');
    await writeFile(elsewhere, 'someone else’s read-along');
    await mkdir(join(root, JOB_ID));
    await symlink(elsewhere, join(root, JOB_ID, 'output.epub'));

    await expect(publisher.validate(jobRow())).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('refuses a job folder the worker replaced with a link', async () => {
    const { publisher } = setup(root);
    const elsewhere = join(root, 'elsewhere');
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, 'output.epub'), 'not this job’s output');
    await symlink(elsewhere, join(root, JOB_ID));

    await expect(publisher.validate(jobRow())).rejects.toMatchObject({ code: 'invalid_output' });
  });
});

describe('ReadAloudWorkspace.readReport', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'read-aloud-report-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a report the worker wrote, and refuses one that links elsewhere', async () => {
    const workspace = new ReadAloudWorkspace({ workRoot: root } as never);
    await mkdir(join(root, JOB_ID));
    await writeFile(join(root, JOB_ID, 'report.json'), '{"chapters":[]}');
    await expect(workspace.readReport(JOB_ID)).resolves.toBe('{"chapters":[]}');

    await rm(join(root, JOB_ID, 'report.json'));
    await writeFile(join(root, 'secret.json'), '{"secret":true}');
    await symlink(join(root, 'secret.json'), join(root, JOB_ID, 'report.json'));
    await expect(workspace.readReport(JOB_ID)).rejects.toThrow('missing, empty, or too large');
  });
});
