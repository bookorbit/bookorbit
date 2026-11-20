import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AI_FEATURE_DEFINITIONS,
  AuditResource,
  NotificationType,
  Permission,
  STORY_GUIDE_FEATURE,
  STORY_GUIDE_FORMATS,
  type AiJobEstimate,
  type AiJobFailureReason,
  type AiJobSubjectRef,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AiSettingsService } from '../ai/ai-settings.service';
import {
  AiJobFailure,
  type AiAssembleContext,
  type AiEstimateReuse,
  type AiFeature,
  type AiJobInfo,
  type AiJobOutcome,
  type AiNotice,
  type AiRefusal,
  type AiStep,
  type AiSubjectLabel,
} from '../ai-jobs/ai-feature';
import { BookService } from '../book/book.service';
import { storyGuidePipelineName } from './pipeline/create-pipeline';
import { STORY_GUIDE_PIPELINE, type StoryGuidePipeline } from './pipeline/story-guide-pipeline';
import type { StoryGuideSubject } from './pipeline/story-guide-subject';
import { StoryGuideEstimator } from './story-guide-estimator.service';
import { StoryGuidesRepository } from './story-guides.repository';
import { StoryTextService, storyTextRefusal } from './story-text.service';
import { isStoryTextFormat } from './story-text.types';
import { STORY_TEXT_EXTRACTION_VERSION } from './text/extraction-version';

const DEFINITION = AI_FEATURE_DEFINITIONS[STORY_GUIDE_FEATURE];

export { storyGuidePipelineName };

/** The steps a pipeline name says changed since another, with every step after them that reads them. */
export function changedSteps(steps: readonly Pick<AiStep, 'id' | 'version' | 'dependsOn'>[], from: string, to: string): string[] {
  if (from === to) return [];
  const before = new Set(from.split('.'));
  if (!before.has(`x${STORY_TEXT_EXTRACTION_VERSION}`)) return steps.map((step) => step.id);
  const changed = new Set<string>();
  for (const step of steps) {
    if (!before.has(`${step.id.slice(0, 2)}${step.version}`) || step.dependsOn.some((id) => changed.has(id))) changed.add(step.id);
  }
  return [...changed];
}

function refFile(ref: AiJobSubjectRef): { bookId: number; fileId: number } {
  return { bookId: Number(ref.bookId), fileId: Number(ref.fileId) };
}

/** Story guides as an AI feature: a book file's text, by its text key, into a format 1 payload. */
@Injectable()
export class StoryGuideFeature implements AiFeature<StoryGuideSubject, unknown> {
  readonly id = STORY_GUIDE_FEATURE;
  readonly formats = [...STORY_GUIDE_FORMATS];
  readonly permission = Permission.LibraryGenerateStoryGuide;
  readonly steps: AiStep<StoryGuideSubject>[];
  readonly pipeline: string;

  constructor(
    private readonly texts: StoryTextService,
    private readonly repository: StoryGuidesRepository,
    private readonly settings: AiSettingsService,
    private readonly books: BookService,
    private readonly estimator: StoryGuideEstimator,
    @Inject(STORY_GUIDE_PIPELINE) private readonly parts: StoryGuidePipeline,
  ) {
    this.steps = parts.steps;
    this.pipeline = storyGuidePipelineName(parts.steps, parts.assembleVersion);
  }

  async resolveSubject(ref: AiJobSubjectRef): Promise<StoryGuideSubject> {
    const { bookId, fileId } = refFile(ref);
    const file = Number.isInteger(fileId) ? await this.texts.file(fileId) : null;
    if (!file || file.bookId !== bookId || !isStoryTextFormat(file.format)) throw new AiJobFailure('unreadable', 'The book file is gone');
    const text = await this.texts.current(file);
    if (!text?.textKey) throw new AiJobFailure('unreadable', "The book file's text could not be read");
    const [book, authors] = await Promise.all([this.repository.findBook(bookId), this.repository.authorNames(bookId)]);
    return { key: text.textKey, bookId, file, text, title: book?.title ?? '', authors };
  }

  async check(subject: StoryGuideSubject): Promise<AiRefusal | null> {
    const own = (await this.settings.features())[STORY_GUIDE_FEATURE];
    if (!own.enabled) return { reason: 'off' };
    const maxWords = own.limits.maxWords ?? DEFINITION.limits.maxWords.default;
    const refusal = storyTextRefusal(subject.text, maxWords);
    if (!refusal) return null;
    return refusal === 'too-long' ? { reason: refusal, limit: maxWords } : { reason: refusal };
  }

  estimate(subject: StoryGuideSubject, reuse: AiEstimateReuse): Promise<AiJobEstimate> {
    return this.estimator.estimate(subject.text, this.stepsToRun(reuse), reuse.models);
  }

  /** What a build runs: everything, except an update, which runs the steps whose version or model changed. */
  stepsToRun(reuse: Pick<AiEstimateReuse, 'kind' | 'models' | 'artifact'>): string[] {
    const all = this.steps.map((step) => step.id);
    if (reuse.kind !== 'update' || !reuse.artifact) return all;
    const changed = new Set(changedSteps(this.steps, reuse.artifact.pipeline, this.pipeline));
    for (const step of this.steps) {
      const built = step.slot ? reuse.artifact.models?.[step.slot] : null;
      const now = step.slot ? reuse.models[step.slot] : null;
      if (built && now && (built.model !== now.model || built.connectionId !== now.connectionId)) changed.add(step.id);
      if (step.dependsOn.some((id) => changed.has(id))) changed.add(step.id);
    }
    return all.filter((id) => changed.has(id));
  }

  assemble(ctx: AiAssembleContext<StoryGuideSubject>): Promise<unknown> {
    return this.parts.assemble(ctx);
  }

  render(artifact: unknown, format: number): unknown {
    return this.parts.render(artifact, format);
  }

  async canReach(user: RequestUser, ref: AiJobSubjectRef): Promise<boolean> {
    try {
      await this.books.verifyBookAccess(refFile(ref).bookId, user);
      return true;
    } catch (error) {
      if (error instanceof NotFoundException) return false;
      throw error;
    }
  }

  async describe(refs: ReadonlyMap<string, AiJobSubjectRef>): Promise<Map<string, AiSubjectLabel>> {
    const bookIds = [...new Set([...refs.values()].map((ref) => refFile(ref).bookId).filter(Number.isSafeInteger))];
    const summaries = await this.repository.summaries(bookIds);
    const labels = new Map<string, AiSubjectLabel>();
    for (const [jobId, ref] of refs) {
      const { bookId } = refFile(ref);
      const book = summaries.get(bookId);
      if (!book) continue;
      labels.set(jobId, {
        label: book.title,
        byline: book.authors.length > 0 ? book.authors.join(', ') : null,
        url: `/book/${bookId}`,
        image: storyGuideBookImage(bookId, book.coverUpdatedAt),
      });
    }
    return labels;
  }

  async notice(job: AiJobInfo, outcome: AiJobOutcome, reason: AiJobFailureReason | null): Promise<AiNotice | null> {
    const { bookId, fileId } = refFile(job.subjectRef);
    const title = (await this.repository.titles([bookId])).get(bookId) ?? null;
    const name = title ?? 'Untitled book';
    const meta = { bookId, fileId, bookTitle: title, kind: job.kind, reason };
    if (outcome === 'completed') {
      return { type: NotificationType.StoryGuideReady, title: `Story guide ready: ${name}`, actionUrl: `/book/${bookId}`, meta };
    }
    return { type: NotificationType.StoryGuideFailed, title: `Story guide failed: ${name}`, actionUrl: `/book/${bookId}`, meta };
  }

  auditTarget(ref: AiJobSubjectRef): { resource: AuditResource; resourceId: number } | null {
    const { bookId } = refFile(ref);
    return Number.isInteger(bookId) ? { resource: AuditResource.Book, resourceId: bookId } : null;
  }
}

/** A book's cover thumbnail, versioned so a new cover is fetched again. */
export function storyGuideBookImage(bookId: number, coverUpdatedAt: Date | null): string {
  const version = coverUpdatedAt ? `?t=${coverUpdatedAt.getTime()}` : '';
  return `/api/v1/books/${bookId}/thumbnail${version}`;
}
