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
  const fileWrite = { embedAudioCoverInDraft: vi.fn().mockResolvedValue({ status: 'success', code: 'embedded', fieldsWritten: [], durationMs: 1 }) };
  const workspace = new ReadAloudWorkspace({ workRoot } as never);
  const publisher = new ReadAloudPublisher(
    { maxOutputBytes: 1e9 } as never,
    jobs as never,
    workspace,
    files as never,
    activity as never,
    fileWrite as never,
  );
  return { publisher, jobs, files, activity, fileWrite };
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

describe('ReadAloudPublisher.publish audio cover', () => {
  let root: string;
  const output = () => join(root, JOB_ID, 'output.epub');

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'read-aloud-cover-'));
    await mkdir(join(root, JOB_ID));
    await writeFile(output(), 'generated read-along');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("embeds the book's audiobook cover in the generated file before it reaches the library", async () => {
    const { publisher, files, fileWrite, activity } = setup(root);
    const order: string[] = [];
    fileWrite.embedAudioCoverInDraft.mockImplementation(() => {
      order.push('embed');
      return Promise.resolve({ status: 'success', code: 'embedded', fieldsWritten: [], durationMs: 1 });
    });
    files.addFile.mockImplementation(() => {
      order.push('add');
      return Promise.resolve({ fileId: 900, reused: false });
    });

    await expect(publisher.publish(jobRow({ replaceFileId: null }), OWNER)).resolves.toBe(900);

    expect(order).toEqual(['embed', 'add']);
    expect(fileWrite.embedAudioCoverInDraft).toHaveBeenCalledWith(12, output());
    expect(activity.record).toHaveBeenCalledWith(JOB_ID, 'info', 'publishing', 'audio_cover_embedded', expect.any(String));
  });

  it('embeds before replacing an existing read-along too', async () => {
    const { publisher, files, fileWrite } = setup(root);

    await publisher.publish(jobRow({ replaceFileId: 300 }), DELETER);

    expect(fileWrite.embedAudioCoverInDraft).toHaveBeenCalledTimes(1);
    expect(files.replaceFile).toHaveBeenCalled();
  });

  it.each([
    ['has no audiobook cover', { status: 'skipped', code: 'no_audio_cover', fieldsWritten: [], durationMs: 0 }],
    ['already holds it', { status: 'skipped', code: 'unchanged', fieldsWritten: [], durationMs: 0 }],
  ])('publishes quietly when the book %s', async (_label, result) => {
    const { publisher, fileWrite, activity } = setup(root);
    fileWrite.embedAudioCoverInDraft.mockResolvedValue(result);

    await expect(publisher.publish(jobRow({ replaceFileId: null }), OWNER)).resolves.toBe(900);

    expect(activity.record).not.toHaveBeenCalledWith(
      JOB_ID,
      expect.anything(),
      'publishing',
      expect.stringMatching(/^audio_cover/),
      expect.anything(),
    );
  });

  it('still publishes, with a warning, when the cover cannot be added', async () => {
    const { publisher, files, fileWrite, activity } = setup(root);
    fileWrite.embedAudioCoverInDraft.mockResolvedValue({
      status: 'failed',
      code: 'failed',
      reason: 'no space left on device',
      fieldsWritten: [],
      durationMs: 1,
    });

    await expect(publisher.publish(jobRow({ replaceFileId: null }), OWNER)).resolves.toBe(900);

    expect(files.addFile).toHaveBeenCalled();
    expect(activity.record).toHaveBeenCalledWith(JOB_ID, 'warn', 'publishing', 'audio_cover_failed', expect.any(String), {
      reason: 'no space left on device',
    });
  });

  it('never writes through a link the worker left in place of the output', async () => {
    const { publisher, fileWrite } = setup(root);
    const elsewhere = join(root, 'another-library.epub');
    await writeFile(elsewhere, 'someone else’s read-along');
    await rm(output());
    await symlink(elsewhere, output());

    await publisher.publish(jobRow({ replaceFileId: null }), OWNER);

    expect(fileWrite.embedAudioCoverInDraft).not.toHaveBeenCalled();
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
