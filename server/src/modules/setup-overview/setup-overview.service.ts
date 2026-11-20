import { Injectable, Logger } from '@nestjs/common';
import { SETUP_MAP_LANES, type SetupMap, type SetupMapFragment, type SetupOverview } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { SetupFlowContribution, SetupFlowContributor } from './setup-flow';
import { SetupFlowRegistry } from './setup-flow.registry';

@Injectable()
export class SetupOverviewService {
  private readonly logger = new Logger(SetupOverviewService.name);

  constructor(private readonly registry: SetupFlowRegistry) {}

  /**
   * Every registered flow, built in parallel.
   *
   * A contributor that throws costs its own card and nothing else: a provider being unreachable is
   * exactly the kind of thing this page exists to show, so it must not be able to take the page
   * down with it.
   */
  async get(viewer: RequestUser): Promise<SetupOverview> {
    const started = Date.now();
    const contributors = this.registry.list();
    const built = await Promise.all(contributors.map((c) => this.buildOne(c, viewer)));

    const cards = built.flatMap((b) => (b?.card ? [b.card] : []));
    const stats = built.flatMap((b) => b?.stats ?? []);
    const map = this.merge(built.flatMap((b) => (b?.map ? [b.map] : [])));
    const failed = built.filter((b) => b === null).length;

    this.logger.log(
      `[setup-overview] [end] flows=${contributors.length} cards=${cards.length} failed=${failed} durationMs=${Date.now() - started} - built the setup overview`,
    );
    return { generatedAt: new Date().toISOString(), stats, cards, map };
  }

  /**
   * Lanes in the order a book meets them, and everything else in the order flows registered.
   *
   * A lane that hands its books to a station nobody drew, because the flow that owns it failed or
   * is not installed, goes to the library instead of pointing at nothing.
   */
  private merge(fragments: SetupMapFragment[]): SetupMap | null {
    const lanes = fragments.flatMap((f) => f.lanes ?? []).sort((a, b) => SETUP_MAP_LANES.indexOf(a.id) - SETUP_MAP_LANES.indexOf(b.id));
    if (lanes.length === 0) return null;
    const stations = new Set(lanes.flatMap((lane) => lane.stations.map((s) => s.id)));
    return {
      lanes: lanes.map((lane) => (lane.into === null || stations.has(lane.into) ? lane : { ...lane, into: null })),
      library: fragments.find((f) => f.library)?.library ?? null,
      out: fragments.flatMap((f) => f.out ?? []),
      services: fragments.flatMap((f) => f.services ?? []).map((s) => (s.asks === null || stations.has(s.asks) ? s : { ...s, asks: null })),
    };
  }

  private async buildOne(contributor: SetupFlowContributor, viewer: RequestUser): Promise<SetupFlowContribution | null> {
    const started = Date.now();
    try {
      return await contributor.build(viewer);
    } catch (error) {
      this.logger.warn(
        `[setup-overview] [fail] flow=${contributor.id} durationMs=${Date.now() - started} errorClass=${
          error instanceof Error ? error.constructor.name : typeof error
        } error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - a flow could not be described`,
      );
      return null;
    }
  }
}
