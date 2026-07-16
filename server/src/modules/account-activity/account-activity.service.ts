import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AccountActivityDetail,
  AccountActivityListItem,
  AccountActivityListResponse,
  AccountActivityState,
  AccountActivitySummary,
  ProvisioningMethod,
} from '@bookorbit/types';
import type { ReadingInsightsSharingLevel } from '@bookorbit/types';

import type { ListAccountActivityDto } from './dto/list-account-activity.dto';
import { AccountActivityRepository } from './account-activity.repository';

const RECENT_ACTIVITY_DAYS = 30;

interface ActivityRow {
  id: number;
  username: string;
  name: string;
  active: boolean;
  isSuperuser: boolean;
  provisioningMethod: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  lastAuthenticatedAt: Date | null;
  readingInsightsSharingLevel: ReadingInsightsSharingLevel;
}

@Injectable()
export class AccountActivityService {
  constructor(private readonly repository: AccountActivityRepository) {}

  async list(query: ListAccountActivityDto): Promise<AccountActivityListResponse> {
    const recentCutoff = this.recentCutoff();
    const result = await this.repository.list({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      state: query.state,
      provisioningMethod: query.provisioningMethod,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      recentCutoff,
    });
    return {
      items: result.items.map((row) => this.toListItem(row, recentCutoff)),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  getSummary(): Promise<AccountActivitySummary> {
    return this.repository.summary(this.recentCutoff());
  }

  async getDetail(userId: number): Promise<AccountActivityDetail> {
    const row = await this.repository.findById(userId);
    if (!row) throw new NotFoundException('User not found');
    return {
      ...this.toListItem(row, this.recentCutoff()),
      email: row.email,
    };
  }

  private recentCutoff(): Date {
    return new Date(Date.now() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
  }

  private toListItem(row: ActivityRow, recentCutoff: Date): AccountActivityListItem {
    return {
      id: row.id,
      username: row.username,
      name: row.name,
      active: row.active,
      isSuperuser: row.isSuperuser,
      provisioningMethod: row.provisioningMethod as ProvisioningMethod,
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lastAuthenticatedAt: row.lastAuthenticatedAt?.toISOString() ?? null,
      state: this.resolveState(row.active, row.lastAuthenticatedAt, recentCutoff),
      readingInsightsSharingLevel: row.readingInsightsSharingLevel,
    };
  }

  private resolveState(active: boolean, lastAuthenticatedAt: Date | null, recentCutoff: Date): AccountActivityState {
    if (!active) return 'disabled';
    if (!lastAuthenticatedAt) return 'never';
    return lastAuthenticatedAt >= recentCutoff ? 'recent' : 'dormant';
  }
}
