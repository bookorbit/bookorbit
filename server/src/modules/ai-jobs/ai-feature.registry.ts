import { Injectable } from '@nestjs/common';

import type { AiFeature, AiSubject } from './ai-feature';

const ID = /^[a-z][a-z0-9-]{0,39}$/;

/** The features the engine can run. Each feature's module registers its own when it starts. */
@Injectable()
export class AiFeatureRegistry {
  private readonly features = new Map<string, AiFeature>();

  register<Subject extends AiSubject, Artifact>(feature: AiFeature<Subject, Artifact>): void {
    validateFeature(feature as unknown as AiFeature);
    if (this.features.has(feature.id)) throw new Error(`AI feature ${feature.id} is already registered`);
    this.features.set(feature.id, feature as unknown as AiFeature);
  }

  get(id: string): AiFeature | null {
    return this.features.get(id) ?? null;
  }

  list(): AiFeature[] {
    return [...this.features.values()];
  }
}

export function validateFeature(feature: AiFeature): void {
  if (!ID.test(feature.id)) throw new Error(`AI feature id "${feature.id}" is not valid`);
  if (feature.pipeline.length === 0 || feature.pipeline.length > 40)
    throw new Error(`AI feature ${feature.id} needs a pipeline of 1 to 40 characters`);
  if (feature.formats.length === 0 || feature.formats.some((format, index) => index > 0 && format <= feature.formats[index - 1]!)) {
    throw new Error(`AI feature ${feature.id} needs formats in ascending order`);
  }
  if (feature.steps.length === 0) throw new Error(`AI feature ${feature.id} has no steps`);
  const seen = new Set<string>();
  for (const step of feature.steps) {
    if (!ID.test(step.id)) throw new Error(`AI feature ${feature.id} step id "${step.id}" is not valid`);
    if (seen.has(step.id)) throw new Error(`AI feature ${feature.id} repeats step ${step.id}`);
    for (const dependency of step.dependsOn) {
      if (!seen.has(dependency)) throw new Error(`AI feature ${feature.id} step ${step.id} depends on ${dependency}, which does not come before it`);
    }
    if (!Number.isInteger(step.version) || step.version < 1) throw new Error(`AI feature ${feature.id} step ${step.id} needs a positive version`);
    seen.add(step.id);
  }
}
