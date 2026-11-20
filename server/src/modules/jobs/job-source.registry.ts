import { Injectable } from '@nestjs/common';
import { JOB_TYPES, type JobType } from '@bookorbit/types';

import type { JobSource } from './job-source';

/** A type's place in `JOB_TYPES`, which breaks ties between types in every view. */
export function jobTypeIndex(type: JobType): number {
  return JOB_TYPES.indexOf(type);
}

/** The job types whose modules registered an adapter, the way features register with `AiFeatureRegistry`. */
@Injectable()
export class JobSourceRegistry {
  private readonly sources = new Map<JobType, JobSource>();

  register(source: JobSource): void {
    if (this.sources.has(source.type)) throw new Error(`Job source already registered: ${source.type}`);
    this.sources.set(source.type, source);
  }

  get(type: string): JobSource | null {
    return this.sources.get(type as JobType) ?? null;
  }

  /** In `JOB_TYPES` order. */
  list(): JobSource[] {
    return [...this.sources.values()].sort((a, b) => jobTypeIndex(a.type) - jobTypeIndex(b.type));
  }
}
