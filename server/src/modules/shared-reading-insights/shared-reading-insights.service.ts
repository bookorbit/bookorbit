import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ReadingInsightsAccessHistoryPage,
  ReadingInsightsPreview,
  ReadingInsightsSharingLevel,
  ReadingInsightsSharingSettings,
  SharedReadingInsightsDetail,
  SharedReadingInsightsSummary,
  SharedReadingInsightsViewSession,
} from '@bookorbit/types';
import { AuditAction, AuditResource } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AuditService } from '../audit/audit.service';
import { SharedReadingInsightsRepository } from './shared-reading-insights.repository';

const VIEW_SESSION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class SharedReadingInsightsService {
  constructor(
    private readonly repository: SharedReadingInsightsRepository,
    private readonly auditService: AuditService,
  ) {}

  async getMySettings(userId: number): Promise<ReadingInsightsSharingSettings> {
    const row = await this.repository.getSharingSettings(userId);
    if (!row) throw new NotFoundException('User not found');
    return this.mapSettings(row);
  }

  async updateMySettings(user: RequestUser, sharingLevel: ReadingInsightsSharingLevel): Promise<ReadingInsightsSharingSettings> {
    const consentedAt = sharingLevel === 'private' ? null : new Date();
    const row = await this.repository.updateSharingSettings(user.id, sharingLevel, consentedAt);
    if (!row) throw new NotFoundException('User not found');
    await this.auditService.record({
      userId: user.id,
      actorUsername: user.username,
      action: AuditAction.ReadingInsightsSharingUpdate,
      resource: AuditResource.ReadingInsightsProfile,
      resourceId: user.id,
      description: `User updated reading insights sharing to '${sharingLevel}'`,
      meta: { sharingLevel },
    });
    return this.mapSettings(row);
  }

  async createViewSession(viewer: RequestUser, subjectUserId: number): Promise<SharedReadingInsightsViewSession> {
    const subject = await this.repository.getSharingSettings(subjectUserId);
    if (!subject) throw new NotFoundException('User not found');
    if (subject.readingInsightsSharingLevel === 'private') {
      throw new ForbiddenException({ message: 'This user is not sharing reading insights', errorCode: 'READING_INSIGHTS_PRIVATE' });
    }
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + VIEW_SESSION_TTL_MS);
    await this.repository.createViewSession({
      id,
      viewerUserId: viewer.id,
      subjectUserId,
      sharingLevel: subject.readingInsightsSharingLevel,
      expiresAt,
    });
    await this.auditService.record({
      userId: viewer.id,
      actorUsername: viewer.username,
      action: AuditAction.ReadingInsightsProfileView,
      resource: AuditResource.ReadingInsightsProfile,
      resourceId: subjectUserId,
      description: `Viewed shared reading insights for user #${subjectUserId}`,
      meta: { subjectUserId, sharingLevel: subject.readingInsightsSharingLevel, viewSessionId: id },
    });
    return { viewSessionId: id, sharingLevel: subject.readingInsightsSharingLevel, expiresAt: expiresAt.toISOString() };
  }

  async getSharedSummary(
    viewer: RequestUser,
    subjectUserId: number,
    viewSessionId: string | undefined,
    days: number,
  ): Promise<SharedReadingInsightsSummary> {
    const sharingLevel = await this.authorizeView(viewer.id, subjectUserId, viewSessionId, 'summary');
    return this.buildSummary(subjectUserId, days, sharingLevel);
  }

  async getSharedDetail(
    viewer: RequestUser,
    subjectUserId: number,
    viewSessionId: string | undefined,
    days: number,
  ): Promise<SharedReadingInsightsDetail> {
    await this.authorizeView(viewer.id, subjectUserId, viewSessionId, 'detailed');
    return this.buildDetail(subjectUserId, days);
  }

  async getMyPreview(userId: number, days: number): Promise<ReadingInsightsPreview> {
    const settings = await this.getMySettings(userId);
    if (settings.sharingLevel === 'private') return settings;
    const summary = await this.buildSummary(userId, days, settings.sharingLevel);
    if (settings.sharingLevel === 'summary') return summary;
    return { summary, detail: await this.buildDetail(userId, days) };
  }

  async getMyAccessHistory(userId: number, page: number, pageSize: number): Promise<ReadingInsightsAccessHistoryPage> {
    const result = await this.auditService.getReadingInsightsAccess(userId, page, pageSize);
    return {
      items: result.items.map((item) => {
        const meta = item.meta as { sharingLevel?: unknown } | null;
        const sharingLevel = meta?.sharingLevel === 'detailed' ? 'detailed' : 'summary';
        return { id: item.id, viewerUsername: item.viewerUsername, sharingLevel, viewedAt: item.viewedAt.toISOString() };
      }),
      total: result.total,
      page,
      pageSize,
    };
  }

  private async authorizeView(
    viewerUserId: number,
    subjectUserId: number,
    viewSessionId: string | undefined,
    requiredLevel: 'summary' | 'detailed',
  ): Promise<'summary' | 'detailed'> {
    if (!viewSessionId) {
      throw new BadRequestException({ message: 'Reading insights view session is required', errorCode: 'READING_INSIGHTS_VIEW_SESSION_REQUIRED' });
    }
    const [session, subject] = await Promise.all([
      this.repository.getViewSession(viewSessionId, viewerUserId, subjectUserId),
      this.repository.getSharingSettings(subjectUserId),
    ]);
    if (!session) {
      throw new ForbiddenException({
        message: 'Reading insights view session is invalid or expired',
        errorCode: 'READING_INSIGHTS_VIEW_SESSION_INVALID',
      });
    }
    if (!subject || subject.readingInsightsSharingLevel === 'private') {
      throw new ForbiddenException({ message: 'This user is not sharing reading insights', errorCode: 'READING_INSIGHTS_PRIVATE' });
    }
    const effectiveLevel = session.sharingLevel === 'detailed' && subject.readingInsightsSharingLevel === 'detailed' ? 'detailed' : 'summary';
    if (requiredLevel === 'detailed' && effectiveLevel !== 'detailed') {
      throw new ForbiddenException({ message: 'This user shares summary insights only', errorCode: 'READING_INSIGHTS_SUMMARY_ONLY' });
    }
    return effectiveLevel;
  }

  private async buildSummary(userId: number, days: number, sharingLevel: 'summary' | 'detailed'): Promise<SharedReadingInsightsSummary> {
    const data = await this.repository.getSummary(userId, days);
    return {
      sharingLevel,
      periodDays: days,
      activeDays: data.daily.length,
      readingSeconds: data.daily.reduce((total, item) => total + item.readingSeconds, 0),
      sessionsCount: data.daily.reduce((total, item) => total + item.sessionsCount, 0),
      booksStarted: data.status.booksStarted,
      booksCompleted: data.status.booksCompleted,
      formatDistribution: data.formats,
      genreDistribution: data.genres,
      sourceCoverage: data.sources,
      trend: data.daily,
    };
  }

  private async buildDetail(userId: number, days: number): Promise<SharedReadingInsightsDetail> {
    const data = await this.repository.getDetail(userId, days);
    const mapBooks = (items: typeof data.topBooks) =>
      items.map((item) => ({
        ...item,
        lastReadAt: item.lastReadAt instanceof Date ? item.lastReadAt.toISOString() : new Date(String(item.lastReadAt)).toISOString(),
      }));
    return {
      sharingLevel: 'detailed',
      periodDays: days,
      topBooks: mapBooks(data.topBooks),
      recentBooks: mapBooks(data.recentBooks),
      topAuthors: data.topAuthors,
      topGenres: data.topGenres,
      topSeries: data.topSeries,
      topNarrators: data.topNarrators,
    };
  }

  private mapSettings(row: {
    readingInsightsSharingLevel?: ReadingInsightsSharingLevel;
    readingInsightsConsentedAt?: Date | null;
    sharingLevel?: ReadingInsightsSharingLevel;
    consentedAt?: Date | null;
  }): ReadingInsightsSharingSettings {
    const sharingLevel = row.readingInsightsSharingLevel ?? row.sharingLevel ?? 'private';
    const consentedAt = row.readingInsightsConsentedAt ?? row.consentedAt ?? null;
    return { sharingLevel, consentedAt: consentedAt?.toISOString() ?? null };
  }
}
