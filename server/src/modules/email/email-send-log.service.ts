import { ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { NewEmailSendLog } from '../../db/schema';
import { EmailSendLogRepository } from './email-send-log.repository';

export const MAX_SEND_ATTEMPTS = 3;
export const SEND_RETRY_DELAYS_MS = [30_000, 120_000];

@Injectable()
export class EmailSendLogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailSendLogService.name);

  constructor(private readonly repo: EmailSendLogRepository) {}

  async onApplicationBootstrap() {
    await this.abandonStalePending();
  }

  async create(values: Omit<NewEmailSendLog, 'status' | 'attemptCount'>) {
    const [entry] = await this.repo.insert({ ...values, status: 'pending', attemptCount: 0 });
    return entry;
  }

  async markSent(id: number) {
    const [entry] = await this.repo.markSent(id);
    return entry;
  }

  async markFailed(id: number, error: string, attemptCount: number): Promise<{ isFinal: boolean }> {
    const nextAttempt = attemptCount + 1;
    const delayMs = SEND_RETRY_DELAYS_MS[attemptCount] ?? null;
    const nextRetryAt = delayMs ? new Date(Date.now() + delayMs) : null;
    const isFinal = nextAttempt >= MAX_SEND_ATTEMPTS || !nextRetryAt;

    await this.repo.markFailed(id, error, isFinal ? null : nextRetryAt);

    return { isFinal };
  }

  async findForUser(user: RequestUser, page: number, size: number) {
    return this.repo.findForUser(user.id, size, page * size);
  }

  async findAllAdmin(page: number, size: number) {
    return this.repo.findAll(size, page * size);
  }

  async findOneOwned(id: number, user: RequestUser) {
    const [entry] = await this.repo.findById(id);
    if (!entry) throw new NotFoundException('Log entry not found');
    if (entry.userId !== user.id) throw new ForbiddenException('No access to this log entry');
    return entry;
  }

  async remove(id: number, user: RequestUser) {
    await this.findOneOwned(id, user);
    await this.repo.delete(id, user.id);
  }

  async getForResend(id: number, user: RequestUser) {
    return this.findOneOwned(id, user);
  }

  private async abandonStalePending() {
    const stale = await this.repo.findPendingRetries(new Date());
    if (stale.length === 0) return;
    this.logger.warn(`Marking ${stale.length} stale pending send(s) as failed — use resend to retry`);
    await Promise.all(stale.map((entry) => this.repo.markAbandoned(entry.id)));
  }
}
