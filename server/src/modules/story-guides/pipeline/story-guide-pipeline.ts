import type { AiAssembleContext, AiStep } from '../../ai-jobs/ai-feature';
import type { StoryGuideSubject } from './story-guide-subject';

/** The story guide's steps and the code that turns their results into a payload. */
export interface StoryGuidePipeline {
  steps: AiStep<StoryGuideSubject>[];
  /** Bumped by any change to how the payload is put together. */
  assembleVersion: number;
  assemble(ctx: AiAssembleContext<StoryGuideSubject>): Promise<unknown>;
  /** Down to an older payload format, or null when it no longer can. */
  render(payload: unknown, format: number): unknown;
}

export const STORY_GUIDE_PIPELINE = Symbol('STORY_GUIDE_PIPELINE');
