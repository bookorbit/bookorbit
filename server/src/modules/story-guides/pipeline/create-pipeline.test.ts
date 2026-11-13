import type { AiJobModels } from '@bookorbit/types';

import { changedSteps, StoryGuideFeature } from '../story-guide.feature';
import { createStoryGuidePipeline, storyGuidePipelineName } from './create-pipeline';

describe('createStoryGuidePipeline', () => {
  const pipeline = createStoryGuidePipeline({ read: vi.fn() });
  const name = storyGuidePipelineName(pipeline.steps, pipeline.assembleVersion);
  /** The pipeline name of a guide built before the summaries step. */
  const beforeSummaries = storyGuidePipelineName(
    pipeline.steps.filter((step) => step.id !== 'summaries'),
    1,
  );

  it('runs the summaries last, after the text and merge they read', () => {
    expect(pipeline.steps.map((step) => step.id)).toEqual(['text', 'names', 'merge', 'review', 'ties', 'lines', 'profiles', 'summaries']);
  });

  it('keeps the pipeline name within the 40 characters a job and an artifact row hold', () => {
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.split('.').slice(-2)).toEqual(['su1', `as${pipeline.assembleVersion}`]);
  });

  it('shortens every step to two letters no other step or the assembly shares', () => {
    const short = pipeline.steps.map((step) => step.id.slice(0, 2));
    expect(new Set([...short, 'as']).size).toBe(short.length + 1);
    expect(short.some((id) => id.startsWith('x'))).toBe(false);
  });

  it('marks a guide built before summaries outdated, and Update reruns only the summaries', () => {
    expect(beforeSummaries).not.toBe(name);
    expect(changedSteps(pipeline.steps, beforeSummaries, name)).toEqual(['summaries']);

    const models: AiJobModels = { fast: { connectionId: 1, model: 'fast-model' }, careful: { connectionId: 1, model: 'careful-model' } };
    const feature = new StoryGuideFeature({} as never, {} as never, {} as never, {} as never, {} as never, pipeline);
    const artifact = { pipeline: beforeSummaries, generation: 1, models };
    expect(feature.stepsToRun({ kind: 'update', models, artifact })).toEqual(['summaries']);
    expect(feature.stepsToRun({ kind: 'rebuild', models, artifact })).toEqual(pipeline.steps.map((step) => step.id));
  });
});
