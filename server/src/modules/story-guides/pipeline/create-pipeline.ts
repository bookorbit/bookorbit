import { Logger } from '@nestjs/common';
import type { AiSlot } from '@bookorbit/types';

import { AiJobFailure, type AiAssembleContext } from '../../ai-jobs/ai-feature';
import { STORY_TEXT_EXTRACTION_VERSION } from '../text/extraction-version';
import { assembleStoryGuide } from './assemble-step';
import { linesAiStep } from './lines-step';
import { mergeAiStep } from './merge-step';
import { namesAiStep } from './names-step';
import { profilesAiStep } from './profiles-step';
import { reviewAiStep } from './review-step';
import { mergeResult, reviewResult, textResult } from './step-context';
import type { StoryLinesResult, StoryProfilesResult, StorySummaryResult, StoryTiesResult } from './story-guide.types';
import type { StoryGuidePipeline } from './story-guide-pipeline';
import type { StoryGuideSubject } from './story-guide-subject';
import { summariesAiStep } from './summaries-step';
import { textAiStep, type StoryTextSource } from './text-step';
import { tiesAiStep } from './ties-step';

const ASSEMBLE_VERSION = 2;

/**
 * The pipeline name: the extraction version and every step's version, so a change to the text
 * rules or any step marks existing guides outdated. Step ids shorten to their first two letters.
 */
export function storyGuidePipelineName(steps: readonly { id: string; version: number }[], assembleVersion: number): string {
  return [`x${STORY_TEXT_EXTRACTION_VERSION}`, ...steps.map((step) => `${step.id.slice(0, 2)}${step.version}`), `as${assembleVersion}`].join('.');
}

/** The story guide's steps, in order, and its payload assembly. */
export function createStoryGuidePipeline(source: StoryTextSource): StoryGuidePipeline {
  const logger = new Logger('StoryGuidePipeline');
  const steps = [textAiStep(source), namesAiStep(), mergeAiStep(), reviewAiStep(), tiesAiStep(), linesAiStep(), profilesAiStep(), summariesAiStep()];
  const pipeline = storyGuidePipelineName(steps, ASSEMBLE_VERSION);

  async function assemble(ctx: AiAssembleContext<StoryGuideSubject>): Promise<unknown> {
    let read: Awaited<ReturnType<StoryTextSource['read']>>;
    try {
      read = await source.read(ctx.subject.file);
    } catch (error) {
      throw new AiJobFailure('unreadable', error instanceof Error ? error.message : String(error));
    }
    if (read.key !== ctx.subject.key) throw new AiJobFailure('source-changed', "the file's text changed since its key was read");
    const models: Partial<Record<AiSlot, string>> = {};
    for (const [slot, choice] of Object.entries(ctx.job.models) as [AiSlot, { model: string } | undefined][]) {
      if (choice) models[slot] = choice.model;
    }
    const { payload, dropped } = assembleStoryGuide({
      textKey: ctx.subject.key,
      pipeline,
      builtAt: new Date().toISOString(),
      language: ctx.subject.text.language ?? 'en',
      models,
      coverage: ctx.coverage,
      sections: ctx.subject.text.sections,
      text: textResult(ctx),
      raw: new Map(read.book.sections.map((section) => [section.index, section.text])),
      merge: mergeResult(ctx),
      review: reviewResult(ctx),
      ties: ctx.results('ties').values() as Iterable<StoryTiesResult>,
      lines: ctx.results('lines').values() as Iterable<StoryLinesResult>,
      profiles: ctx.results('profiles').values() as Iterable<StoryProfilesResult>,
      summaries: ctx.results('summaries').values() as Iterable<StorySummaryResult>,
    });
    const lost = dropped.names + dropped.entries + dropped.lines + dropped.profiles + dropped.summaries + dropped.quotes;
    logger.log(
      `[story_guide.assemble] [end] jobId=${ctx.job.id} entities=${payload.entities.length} ties=${payload.ties.length} summaries=${payload.summaries?.length ?? 0} unanchored=${lost} - payload assembled`,
    );
    return payload;
  }

  return {
    steps,
    assembleVersion: ASSEMBLE_VERSION,
    assemble,
    render: (payload, format) => (format === 1 ? payload : null),
  };
}
