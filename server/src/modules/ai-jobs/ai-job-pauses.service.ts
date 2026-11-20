import { Inject, Injectable } from '@nestjs/common';
import type { AiJobPauseReason } from '@bookorbit/types';

import type { AiJobRow } from '../../db/schema';
import { slotsOf, type AiFeature } from './ai-feature';
import { AI_JOBS_PORTS, type AiJobsPorts } from './ai-jobs.ports';

/**
 * Whether a paused job could run now. The auto-resume reads each cause's last known state; Try again
 * tests the connections now.
 */
@Injectable()
export class AiJobPauses {
  constructor(@Inject(AI_JOBS_PORTS) private readonly ports: AiJobsPorts) {}

  /**
   * The first cause that still keeps the job from running, in the order a run checks them, or null.
   * An over-estimate pause holds until Continue. The budget is checked last, by reserving it, so a
   * job another cause still holds reserves nothing.
   */
  async blocker(row: AiJobRow, feature: AiFeature, retest: boolean): Promise<AiJobPauseReason | null> {
    if (row.reason === 'over-estimate') return 'over-estimate';
    if (!(await this.ports.settings.get(feature.id)).enabled) return 'off';
    let models = row.models ?? {};
    const unrecorded = slotsOf(feature).filter((slot) => !models[slot]);
    if (unrecorded.length > 0) {
      const resolved = await this.ports.slots.resolve(feature.id, unrecorded);
      if (resolved.missing.length > 0) return 'slot-empty';
      models = { ...models, ...resolved.models };
    }
    const health = retest ? await this.ports.health.retest(feature.id, models) : await this.ports.health.check(feature.id, models);
    if (health) return health;
    const reservation = await this.ports.budget.reserve({ jobId: row.id, feature: feature.id, amount: row.estimate?.cost ?? null });
    return reservation.ok ? null : 'budget';
  }
}
