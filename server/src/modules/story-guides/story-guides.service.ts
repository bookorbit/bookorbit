import { createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AI_FEATURE_DEFINITIONS,
  AI_JOB_KINDS,
  isContentBookFile,
  Permission,
  STORY_GUIDE_FEATURE,
  type AiJobKind,
  type AiJobModels,
  type StoryGuideBuild,
  type StoryGuideBuildReason,
  type StoryGuideContentMissing,
  type StoryGuideDeleteAllResponse,
  type StoryGuideEstimate,
  type StoryGuideFixesChoice,
  type StoryGuideHistory,
  type StoryGuideInfo,
  type StoryGuideList,
  type StoryGuideJob,
  type StoryGuidePayloadV1,
  type StoryGuideStatus,
  type StoryGuidesAppInfo,
  type StoryGuidesSummary,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { rankFilesByFormatPriority } from '../../common/utils/primary-file-selection.utils';
import type { AiJobRow, BookFileTextRow } from '../../db/schema';
import { AiSettingsService } from '../ai/ai-settings.service';
import { slotsOf } from '../ai-jobs/ai-feature';
import type { AiArtifactInfo } from '../ai-jobs/ai-artifact.repository';
import { mayRun } from '../ai-jobs/ai-job-checks.service';
import { AiJobsService, modelsChanged } from '../ai-jobs/ai-jobs.service';
import { BookService } from '../book/book.service';
import { StoryGuideFixesService } from './fixes/story-guide-fixes.service';
import { StoryGuideFeature, storyGuideBookImage } from './story-guide.feature';
import { StoryGuideEstimator } from './story-guide-estimator.service';
import { StoryGuidesRepository, type StoryGuideBookFile, type StoryGuideListFilter } from './story-guides.repository';
import { StoryTextService, storyTextRefusal } from './story-text.service';
import { isStoryTextFormat } from './story-text.types';

const DEFINITION = AI_FEATURE_DEFINITIONS[STORY_GUIDE_FEATURE];

/** What a build request ended in, with the status to answer either way. */
export type StoryGuideBuildResult = { kind: 'queued' | 'conflict' | 'refused'; status: StoryGuideStatus };

export type StoryGuideContent =
  | { kind: 'found'; body: unknown; etag: string }
  | { kind: 'not-modified'; etag: string }
  | { kind: 'missing'; reason: StoryGuideContentMissing['reason'] };

export interface StoryGuideStatusView {
  status: StoryGuideStatus;
  etag: string;
}

/** Whether the caller sees dollars: app settings managers and superusers. */
function seesCost(user: RequestUser): boolean {
  return user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings);
}

function etagOf(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
}

/** The book's files a story guide can read, in the order the book page would open them. */
export function storyGuideFiles(
  files: readonly StoryGuideBookFile[],
  formatPriority: readonly string[] | null,
  primaryFileId: number | null,
): StoryGuideBookFile[] {
  return rankFilesByFormatPriority(
    files.filter((file) => isContentBookFile(file) && isStoryTextFormat(file.format)),
    formatPriority,
    primaryFileId,
  );
}

/**
 * Story guide status and building, per book file. Status is a cache read: it never reads a book,
 * and a file with no fresh text key is queued for the key job and reported as `checking`.
 */
@Injectable()
export class StoryGuidesService {
  constructor(
    private readonly feature: StoryGuideFeature,
    private readonly jobs: AiJobsService,
    private readonly texts: StoryTextService,
    private readonly repository: StoryGuidesRepository,
    private readonly books: BookService,
    private readonly settings: AiSettingsService,
    private readonly fixes: StoryGuideFixesService,
    private readonly estimator: StoryGuideEstimator,
  ) {}

  async status(bookId: number, fileId: number | undefined, user: RequestUser): Promise<StoryGuideStatusView> {
    await this.books.verifyBookAccess(bookId, user);
    const file = await this.pickFile(bookId, fileId);
    const status = await this.statusFor(file, user, null);
    return { status, etag: etagOf(status) };
  }

  async build(bookId: number, fileId: number | undefined, kind: AiJobKind, user: RequestUser): Promise<StoryGuideBuildResult> {
    await this.books.verifyBookAccess(bookId, user);
    const file = await this.pickFile(bookId, fileId);
    const full = file ? await this.texts.file(file.id) : null;
    // A build may read the book now: the caller asked for one.
    const text = full ? await this.texts.current(full) : null;
    if (!file || !text) return { kind: 'refused', status: await this.statusFor(file, user, text) };
    const result = await this.jobs.request({ feature: STORY_GUIDE_FEATURE, kind, subjectRef: { bookId, fileId: file.id }, actor: user });
    const status = await this.statusFor(file, user, text);
    if (result.kind === 'created') return { kind: 'queued', status };
    return { kind: result.kind, status };
  }

  async retry(bookId: number, fileId: number | undefined, user: RequestUser): Promise<StoryGuideStatus> {
    await this.books.verifyBookAccess(bookId, user);
    const file = await this.pickFile(bookId, fileId);
    if (file) await this.jobs.retry({ feature: STORY_GUIDE_FEATURE, subjectRef: { bookId, fileId: file.id }, actor: user });
    return await this.statusFor(file, user, null);
  }

  async cancel(bookId: number, fileId: number | undefined, user: RequestUser): Promise<StoryGuideStatus> {
    await this.books.verifyBookAccess(bookId, user);
    const file = await this.pickFile(bookId, fileId);
    const key = file ? (await this.texts.cached(await this.fullFile(file)))?.textKey : null;
    if (key) await this.jobs.cancel({ feature: STORY_GUIDE_FEATURE, subjectKey: key, actor: user });
    return await this.statusFor(file, user, null);
  }

  /** Cancels any unfinished job, then removes the guide, and its fixes for everyone when asked. */
  async remove(bookId: number, fileId: number | undefined, fixes: StoryGuideFixesChoice, user: RequestUser): Promise<StoryGuideStatus> {
    await this.books.verifyBookAccess(bookId, user);
    const file = await this.pickFile(bookId, fileId);
    const key = file ? (await this.texts.cached(await this.fullFile(file)))?.textKey : null;
    if (file && key) {
      await this.jobs.remove({ feature: STORY_GUIDE_FEATURE, subjectKey: key, subjectRef: { bookId, fileId: file.id }, actor: user });
      if (fixes === 'delete') await this.fixes.removeForText(key, user);
    }
    return await this.statusFor(file, user, null);
  }

  /**
   * The guide for a book file, in the newest of the asked formats it can be rendered to, with its
   * fixes for everyone applied. A cache read like status: a file whose text key is not known yet has
   * no guide to send. The tag covers the guide, the format and the fixes revision, so a fix or a
   * Rebuild both change it; a match answers `not-modified` without applying the fixes.
   */
  async content(fileId: number, formats: readonly number[], user: RequestUser, ifNoneMatch?: string): Promise<StoryGuideContent> {
    const file = await this.texts.file(fileId);
    if (!file) throw new NotFoundException(`Book file ${fileId} not found`);
    await this.books.verifyBookAccess(file.bookId, user);
    const text = isStoryTextFormat(file.format) ? await this.texts.cached(file) : null;
    if (!text?.textKey) return { kind: 'missing', reason: 'none' };
    const read = await this.jobs.readArtifact(STORY_GUIDE_FEATURE, text.textKey, formats);
    if (read.kind !== 'found') return { kind: 'missing', reason: read.kind };
    const fixes = await this.fixes.state(text.textKey);
    const etag = `"${read.sha256.slice(0, 32)}.f${read.format}${fixes.revision > 0 ? `.r${fixes.revision}` : ''}"`;
    if (ifNoneMatch === etag) return { kind: 'not-modified', etag };
    const body =
      read.format === 1 && fixes.revision > 0
        ? await this.fixes.apply(text.textKey, read.body as StoryGuidePayloadV1, read.sha256, fixes)
        : read.body;
    return { kind: 'found', body, etag };
  }

  async summary(): Promise<StoryGuidesSummary> {
    const [guides, fixes] = await Promise.all([this.jobs.artifactSummary(STORY_GUIDE_FEATURE), this.fixes.countLive()]);
    return { ...guides, fixes };
  }

  /** One page of stored guides, each with the book it reads and the build that made it. */
  async listGuides(filter: StoryGuideListFilter): Promise<StoryGuideList> {
    const { rows, total } = await this.repository.listGuides(filter);
    const bookIds = [...new Set(rows.map((row) => row.bookId).filter((id): id is number => id !== null))];
    const books = await this.repository.summaries(bookIds);
    return {
      total,
      items: rows.map((row) => {
        const book = row.bookId === null ? undefined : books.get(row.bookId);
        return {
          key: row.key,
          bookId: book ? row.bookId : null,
          fileId: book ? row.fileId : null,
          title: book?.title ?? null,
          byline: book && book.authors.length > 0 ? book.authors.join(', ') : null,
          image: book && row.bookId !== null ? storyGuideBookImage(row.bookId, book.coverUpdatedAt) : null,
          words: row.words,
          kind: isAiJobKind(row.kind) ? row.kind : null,
          builtAt: row.builtAt.toISOString(),
          seconds: row.seconds === null ? null : Math.round(row.seconds),
          cost: row.costMicros === null ? null : row.costMicros / 1_000_000,
          bytes: row.bytes,
          coverage: row.coverage,
          models: row.models,
        };
      }),
    };
  }

  /** What the stored guides took to build, from the jobs that built them. */
  async history(): Promise<StoryGuideHistory> {
    const history = await this.repository.guideHistory();
    return {
      cost: history.costMicros / 1_000_000,
      medianSeconds: history.medianSeconds === null ? null : Math.round(history.medianSeconds),
      models: history.models.map((entry) => ({
        fast: entry.fast,
        careful: entry.careful,
        builds: entry.builds,
        averageSeconds: entry.averageSeconds === null ? null : Math.round(entry.averageSeconds),
        averageCost: entry.averageCostMicros === null ? null : entry.averageCostMicros / 1_000_000,
      })),
    };
  }

  /** `count` must equal the number of guides now; otherwise nothing is removed, fixes included. */
  async removeAll(count: number, fixes: StoryGuideFixesChoice, user: RequestUser): Promise<StoryGuideDeleteAllResponse | { countChanged: number }> {
    const result = await this.jobs.removeAll(STORY_GUIDE_FEATURE, count, user);
    if (result.kind === 'count-changed') return { countChanged: result.count };
    if (fixes === 'delete') await this.fixes.removeAll(user);
    return { deleted: result.removed, cancelled: result.cancelled };
  }

  /** For `app-info`: whether builds are allowed now, and whether any guide exists. */
  async appInfo(): Promise<StoryGuidesAppInfo> {
    const [features, slots, count] = await Promise.all([
      this.settings.features(),
      this.settings.slots(),
      this.jobs.countArtifacts(STORY_GUIDE_FEATURE),
    ]);
    const ready = DEFINITION.slots.every((slot) => slots[slot].connectionId !== null && slots[slot].model !== null);
    return { building: features[STORY_GUIDE_FEATURE].enabled && ready, served: count > 0 };
  }

  /** Book titles for the jobs of this feature, for the usage page. */
  async jobLabels(jobIds: readonly string[]): Promise<Map<string, string>> {
    const refs = await this.jobs.subjectRefs(jobIds);
    const bookIds = [...new Set([...refs.values()].map((ref) => Number(ref.bookId)).filter(Number.isInteger))];
    const titles = await this.repository.titles(bookIds);
    const labels = new Map<string, string>();
    for (const [jobId, ref] of refs) {
      const title = titles.get(Number(ref.bookId));
      if (title) labels.set(jobId, title);
    }
    return labels;
  }

  /** The asked file when it belongs to the book; otherwise the first one the book page would open. */
  private async pickFile(bookId: number, fileId: number | undefined): Promise<StoryGuideBookFile | null> {
    const [book, files] = await Promise.all([this.repository.findBook(bookId), this.repository.findFiles(bookId)]);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);
    if (fileId !== undefined) {
      const file = files.find((candidate) => candidate.id === fileId);
      if (!file) throw new NotFoundException(`Book file ${fileId} not found`);
      return file;
    }
    return storyGuideFiles(files, book.formatPriority, book.primaryFileId)[0] ?? null;
  }

  private async fullFile(file: StoryGuideBookFile) {
    const full = await this.texts.file(file.id);
    if (!full) throw new NotFoundException(`Book file ${file.id} not found`);
    return full;
  }

  /** The status for a file. `known` is a row the caller already read; otherwise only the cache is read. */
  private async statusFor(file: StoryGuideBookFile | null, user: RequestUser, known: BookFileTextRow | null): Promise<StoryGuideStatus> {
    const canManage = mayRun(user, this.feature);
    const usable = file && isContentBookFile(file) && isStoryTextFormat(file.format) ? file : null;
    const text = usable ? (known ?? (await this.texts.cached(await this.fullFile(usable)))) : null;
    const key = text?.textKey ?? null;
    const [jobStatus, own, models] = await Promise.all([
      key ? this.jobs.status(STORY_GUIDE_FEATURE, key) : Promise.resolve(null),
      this.settings.features().then((features) => features[STORY_GUIDE_FEATURE]),
      this.jobs.models(STORY_GUIDE_FEATURE),
    ]);
    const artifact = jobStatus?.artifact ?? null;
    const guide = artifact ? this.guideInfo(artifact, models, canManage) : null;
    if (guide && canManage && key) guide.orphanedFixes = await this.fixes.orphanCount(key);
    const job = jobStatus?.job ? await this.jobInfo(jobStatus.job, jobStatus.ahead, canManage, seesCost(user), { text, artifact, models }) : null;

    const maxWords = own.limits.maxWords ?? DEFINITION.limits.maxWords.default;
    const reason = this.buildReason(usable, own.enabled, text, maxWords);
    const build: StoryGuideBuild = !canManage
      ? { allowed: false }
      : reason
        ? { allowed: false, reason, ...(reason === 'too-long' ? { limit: maxWords } : {}) }
        : { allowed: true };

    const status: StoryGuideStatus = { fileId: file?.id ?? null, textKey: key, canManage, build, guide, job };
    if (canManage && text && !reason) {
      const cost = seesCost(user);
      status.estimate = await this.estimateFor(text, 'build', models, null, cost);
      if (guide && (guide.outdated || guide.modelsChanged) && artifact) {
        status.updateEstimate = await this.estimateFor(text, 'update', models, artifact, cost);
        delete status.updateEstimate.words;
      }
    }
    return status;
  }

  private buildReason(
    file: StoryGuideBookFile | null,
    enabled: boolean,
    text: BookFileTextRow | null,
    maxWords: number,
  ): StoryGuideBuildReason | null {
    if (!file) return 'no-text-file';
    if (!enabled) return 'off';
    if (!text) return 'checking';
    return storyTextRefusal(text, maxWords);
  }

  private guideInfo(artifact: AiArtifactInfo, current: AiJobModels, canManage: boolean): StoryGuideInfo {
    return {
      builtAt: artifact.builtAt.toISOString(),
      ...(canManage ? { models: artifact.models } : {}),
      coverage: artifact.coverage,
      format: artifact.format,
      outdated: artifact.pipeline !== this.feature.pipeline,
      modelsChanged: modelsChanged(artifact.models, current, slotsOf(this.feature)),
    };
  }

  private async jobInfo(
    row: AiJobRow,
    ahead: number | null,
    canManage: boolean,
    withCost: boolean,
    context: { text: BookFileTextRow | null; artifact: AiArtifactInfo | null; models: AiJobModels },
  ): Promise<StoryGuideJob> {
    const state = row.status as StoryGuideJob['state'];
    const job: StoryGuideJob = { kind: row.kind as AiJobKind, state, phase: row.phase };
    if (!canManage) return job;
    if (withCost && row.costMicros !== null) job.spentCost = Math.round(row.costMicros / 100) / 10_000;
    if (state === 'paused' || state === 'failed') job.reason = row.reason;
    if (state === 'queued' && ahead !== null) job.position = ahead + 1;
    if (state === 'running') {
      job.done = row.done;
      job.total = row.total;
      job.minutesLeft = context.text ? await this.minutesLeft(row, context.text, context.artifact, context.models) : null;
    }
    return job;
  }

  /** From the job's progress and the speed its own models have shown, not from the clock. */
  private minutesLeft(row: AiJobRow, text: BookFileTextRow, artifact: AiArtifactInfo | null, current: AiJobModels): Promise<number | null> {
    const models: AiJobModels = { ...current, ...row.models };
    const steps = this.feature.stepsToRun({
      kind: row.kind as AiJobKind,
      models,
      artifact: artifact ? { pipeline: artifact.pipeline, generation: artifact.generation, models: artifact.models } : null,
    });
    return this.estimator.minutesLeft(text, steps, models, {
      order: this.feature.steps.map((step) => step.id),
      phase: row.phase,
      done: row.done,
      total: row.total,
    });
  }

  private async estimateFor(
    text: BookFileTextRow,
    kind: AiJobKind,
    models: AiJobModels,
    artifact: AiArtifactInfo | null,
    withCost: boolean,
  ): Promise<StoryGuideEstimate> {
    const steps = this.feature.stepsToRun({
      kind,
      models,
      artifact: artifact ? { pipeline: artifact.pipeline, generation: artifact.generation, models: artifact.models } : null,
    });
    const estimate = await this.estimator.estimate(text, steps, models);
    return { words: estimate.words, minutes: estimate.minutes, ...(withCost ? { cost: estimate.cost } : {}) };
  }
}

function isAiJobKind(kind: string | null): kind is AiJobKind {
  return kind !== null && (AI_JOB_KINDS as readonly string[]).includes(kind);
}
