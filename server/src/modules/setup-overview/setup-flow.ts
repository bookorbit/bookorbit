import type { SetupFlowCard, SetupFlowId, SetupMapFragment, SetupStat, SetupText } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';

/** Everything one flow puts on the page, from a single read of its settings. */
export interface SetupFlowContribution {
  /** Null when the flow has nothing to describe on this install; the page leaves it out. */
  card: SetupFlowCard | null;
  /** Numbers for the strip at the top of the page. */
  stats: SetupStat[];
  /** This flow's part of the map: its lane, where it sends books, or the service it is. */
  map: SetupMapFragment | null;
}

/**
 * One flow, described by the module that owns the settings it reads.
 *
 * Contributors live in their own feature module and read through that module's own services, the
 * way `JobSource` adapters do. That keeps the page honest: a setting added later is added next to
 * the card that shows it, rather than in a central builder nobody remembers to update. The card,
 * the numbers and the map piece come from one call so a flow reads its settings once per page.
 */
export interface SetupFlowContributor {
  readonly id: SetupFlowId;
  build(viewer: RequestUser): Promise<SetupFlowContribution>;
}

/**
 * Stations on the map that a flow other than their owner points at: requests are filed by the dock,
 * and the dock asks metadata providers when it matches. Shared here so neither module reaches into
 * the other.
 */
export const SETUP_MAP_STATIONS = {
  dockMatched: 'dock-matched',
  dockFiles: 'dock-files',
} as const;

/** A message under `setupOverview.<flow>.`, the shape every contributor writes its copy in. */
export function setupTextFor(flow: string) {
  const prefix = `setupOverview.${flow}.`;
  return (key: string, values?: Record<string, string | number>, money?: string[]): SetupText =>
    money ? { key: prefix + key, values, money } : { key: prefix + key, values };
}
