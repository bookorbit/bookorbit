import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { readAloudConfig } from '../../config/config';
import { InvalidReportError } from './read-aloud-report';
import { READ_ALOUD_MAX_REPORT_BYTES } from './read-aloud.constants';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** The per-job folders under `<APP_DATA_PATH>/read-aloud/jobs`, shared with the worker by path. */
@Injectable()
export class ReadAloudWorkspace {
  constructor(@Inject(readAloudConfig.KEY) private readonly config: ConfigType<typeof readAloudConfig>) {}

  get root(): string {
    return this.config.workRoot;
  }

  dir(jobId: string): string {
    if (!JOB_ID.test(jobId)) throw new Error('Invalid read-aloud job id');
    return join(this.config.workRoot, jobId);
  }

  outputPath(jobId: string): string {
    return join(this.dir(jobId), 'output.epub');
  }

  reportPath(jobId: string): string {
    return join(this.dir(jobId), 'report.json');
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.config.workRoot, { recursive: true });
  }

  async ensure(jobId: string): Promise<void> {
    await mkdir(this.dir(jobId), { recursive: true });
  }

  async remove(jobId: string): Promise<void> {
    await rm(this.dir(jobId), { recursive: true, force: true }).catch(() => undefined);
  }

  async listJobIds(): Promise<string[]> {
    const entries = await readdir(this.config.workRoot, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory() && JOB_ID.test(entry.name)).map((entry) => entry.name);
  }

  async readReport(jobId: string): Promise<string | null> {
    const path = this.reportPath(jobId);
    const info = await this.inspect(jobId, path);
    if (!info) return null;
    if (!info.isFile() || info.size <= 0 || info.size > READ_ALOUD_MAX_REPORT_BYTES) {
      throw new InvalidReportError('The alignment report is missing, empty, or too large');
    }
    const handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
    try {
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  }

  /**
   * Describes a file the worker wrote, without following links: a symlink in place of the file or
   * of the job folder could otherwise point the server at another library's files. Null when missing.
   */
  async inspect(jobId: string, path: string): Promise<Stats | null> {
    const folder = await lstat(this.dir(jobId)).catch(() => null);
    if (!folder?.isDirectory()) return null;
    return await lstat(path).catch(() => null);
  }
}
