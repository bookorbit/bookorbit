import { Injectable } from '@nestjs/common';
import { SETUP_FLOW_IDS, type SetupFlowId } from '@bookorbit/types';

import type { SetupFlowContributor } from './setup-flow';

/** The flows whose modules registered a contributor, the way job types register with `JobSourceRegistry`. */
@Injectable()
export class SetupFlowRegistry {
  private readonly contributors = new Map<SetupFlowId, SetupFlowContributor>();

  register(contributor: SetupFlowContributor): void {
    if (this.contributors.has(contributor.id)) throw new Error(`Setup flow already registered: ${contributor.id}`);
    this.contributors.set(contributor.id, contributor);
  }

  /** In `SETUP_FLOW_IDS` order, which is the order the page draws them. */
  list(): SetupFlowContributor[] {
    return SETUP_FLOW_IDS.map((id) => this.contributors.get(id)).filter((c): c is SetupFlowContributor => c !== undefined);
  }
}
