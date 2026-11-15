import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { appConfig } from '../../config/config';
import { Permission, type BookChapterJobKind } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { JobChangesService } from '../jobs/job-changes.service';
import { UserService } from '../user/user.service';
import { ChapterEditorService } from './chapter-editor.service';
import { CHAPTER_JOB_RETENTION_MS, ChapterJobRepository } from './chapter-job.repository';

const PURGE_INTERVAL_MS = 60 * 60_000;

@Injectable()
export class ChapterJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChapterJobService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private needsRecovery = false;

  constructor(
    private readonly repo: ChapterJobRepository,
    private readonly editor: ChapterEditorService,
    private readonly books: BookService,
    private readonly users: UserService,
    private readonly changes: JobChangesService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async start(bookId: number, kind: BookChapterJobKind, baseRevision: string, user: RequestUser, retry = false) {
    await this.books.verifyBookAccess(bookId, user, 'editor');
    const job = await this.repo.enqueue(bookId, user.id, kind, baseRevision, retry);
    this.changed(user.id);
    return job;
  }

  async latest(bookId: number, user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user, 'editor');
    return this.repo.latest(bookId, user.id);
  }

  async status(bookId: number, id: string, user: RequestUser) {
    await this.books.verifyBookAccess(bookId, user, 'editor');
    const job = await this.repo.find(bookId, user.id, id);
    if (!job) throw new NotFoundException('Chapter operation not found');
    return job;
  }

  async onModuleInit(): Promise<void> {
    await this.recover();
    if (this.app.nodeEnv === 'test') return;
    void this.purge();
    this.timer = setInterval(() => void this.tick(), 2_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    const startedAt = Date.now();
    try {
      if (this.needsRecovery) {
        await this.recover();
        this.needsRecovery = false;
      }
      const job = await this.repo.claim();
      if (!job) return;
      this.changed(job.userId);
      try {
        const user = await this.users.findByIdWithPermissions(job.userId);
        if (!user?.active || (!user.isSuperuser && !user.permissions.includes(Permission.LibraryEditMetadata))) throw new ForbiddenException();
        const dto = { baseRevision: job.baseRevision };
        const progress = async (done: number, total: number) => {
          await this.repo.progress(job.id, done, total);
          this.changed(job.userId, false);
        };
        const result =
          job.kind === 'write'
            ? await this.editor.writeToFiles(job.bookId, dto, user, progress)
            : job.kind === 'revert'
              ? await this.editor.revert(job.bookId, dto, user, progress)
              : await this.editor.readEmbedded(job.bookId, user, progress);
        await this.repo.finish(job.id, result);
      } catch (error) {
        const body = error instanceof HttpException ? error.getResponse() : null;
        const code = typeof body === 'object' && body && 'errorCode' in body ? String(body.errorCode) : 'book_chapters_operation_failed';
        await this.repo.finish(job.id, undefined, code);
      }
      this.changed(job.userId);
    } catch (error) {
      this.logger.warn(
        `[chapter_operation] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - chapter operation failed`,
      );
      this.needsRecovery = true;
      try {
        await this.recover();
        this.needsRecovery = false;
      } catch {
        // Retry recovery before claiming another operation when the database reconnects.
      }
    } finally {
      this.running = false;
    }
  }

  /** Removes finished jobs older than the retention, off the request path. */
  @Interval(PURGE_INTERVAL_MS)
  async purge(): Promise<number> {
    const startedAt = Date.now();
    try {
      const removed = await this.repo.purgeFinished(new Date(Date.now() - CHAPTER_JOB_RETENTION_MS));
      if (removed > 0) {
        this.changed(null);
        this.logger.log(`[chapter_operation.purge] [end] removed=${removed} durationMs=${Date.now() - startedAt} - old chapter operations removed`);
      }
      return removed;
    } catch (error) {
      this.logger.warn(
        `[chapter_operation.purge] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - old chapter operations not removed`,
      );
      return 0;
    }
  }

  private async recover(): Promise<void> {
    if ((await this.repo.recover()) > 0) this.changed(null);
  }

  /** Tells the Jobs area; `state` false when only progress moved. */
  private changed(ownerId: number | null, state = true): void {
    this.changes.notify({ type: 'chapter-edit', ownerId, state });
  }
}
