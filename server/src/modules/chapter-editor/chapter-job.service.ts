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
import { appConfig } from '../../config/config';
import { Permission, type BookChapterJobKind } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { UserService } from '../user/user.service';
import { ChapterEditorService } from './chapter-editor.service';
import { ChapterJobRepository } from './chapter-job.repository';

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
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async start(bookId: number, kind: BookChapterJobKind, baseRevision: string, user: RequestUser, retry = false) {
    await this.books.verifyBookAccess(bookId, user, 'editor');
    return this.repo.enqueue(bookId, user.id, kind, baseRevision, retry);
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
    await this.repo.recover();
    if (this.app.nodeEnv === 'test') return;
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
        await this.repo.recover();
        this.needsRecovery = false;
      }
      const job = await this.repo.claim();
      if (!job) return;
      try {
        const user = await this.users.findByIdWithPermissions(job.userId);
        if (!user?.active || (!user.isSuperuser && !user.permissions.includes(Permission.LibraryEditMetadata))) throw new ForbiddenException();
        const dto = { baseRevision: job.baseRevision };
        const progress = (done: number, total: number) => this.repo.progress(job.id, done, total);
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
    } catch (error) {
      this.logger.warn(
        `[chapter_operation] [fail] durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - chapter operation failed`,
      );
      this.needsRecovery = true;
      try {
        await this.repo.recover();
        this.needsRecovery = false;
      } catch {
        // Retry recovery before claiming another operation when the database reconnects.
      }
    } finally {
      this.running = false;
    }
  }
}
