/**
 * The Setup Overview: the instance's own configuration, read back as flows.
 *
 * Nothing here carries English. Every piece of copy is a stable code and the values to put in it,
 * so the page translates and numbers format per locale. A client that meets a code it does not
 * know falls back to the code's own text rather than failing the whole page, which is what lets a
 * newer server answer an older client.
 */

/** The five flows, in the order the page draws them. */
export const SETUP_FLOW_IDS = ["ingest", "requests", "metadata", "ai", "out"] as const;
export type SetupFlowId = (typeof SETUP_FLOW_IDS)[number];

/** `ok`: nothing to do. `attention`: something in this flow needs a person. `off`: nothing configured. */
export const SETUP_FLOW_STATES = ["ok", "attention", "off"] as const;
export type SetupFlowState = (typeof SETUP_FLOW_STATES)[number];

/** A message key under `setupOverview.`, and the values its placeholders take. */
export interface SetupText {
  key: string;
  values?: Record<string, string | number>;
  /** Names of numeric values that are US dollar amounts, which the page formats as currency. */
  money?: string[];
}

/**
 * The key for text that must not be translated: a library name, a folder name, a device name.
 * The page prints `values.text` as it stands. User-authored and bibliographic text always uses
 * this rather than being folded into a message.
 */
export const SETUP_TEXT_RAW = "raw";

/** Names a person or a provider wrote, passed through untouched. */
export function setupRaw(text: string): SetupText {
  return { key: SETUP_TEXT_RAW, values: { text } };
}

/**
 * One step on a flow's track. `edge` is the label that sits on the wire leaving this step, so the
 * last step has none.
 */
export interface SetupStep {
  id: string;
  /** A Lucide icon name the page already bundles; an unknown one draws no glyph. */
  icon: string;
  label: SetupText;
  /** At most two short lines under the step. */
  lines: SetupText[];
  edge: SetupText | null;
  /** The step a book has arrived at, drawn as the end of the track. At most one per flow. */
  terminal?: boolean;
}

/** Work that leaves the track at one step and rejoins at another; `at === back` is a loop. */
export interface SetupBranch {
  at: string;
  back: string;
  label: SetupText;
  sub: SetupText | null;
}

/** A row of the card's table. Cells are already formatted text, except `state`, which is drawn as a dot. */
export const SETUP_CELL_STATES = ["on", "off", "warn", "bad"] as const;
export type SetupCellState = (typeof SETUP_CELL_STATES)[number];

export interface SetupCell {
  text: SetupText;
  state?: SetupCellState;
  /** A secondary cell. It steps back by weight rather than colour, so it stays as readable as the rest. */
  dim?: boolean;
}

export interface SetupTable {
  columns: SetupText[];
  rows: SetupCell[][];
}

/** Something in this flow that needs a person, with the page that fixes it. */
export interface SetupWarning {
  /** Stable, so a client may show its own copy: `dock_folder_removed`, `indexer_unauthorized`, ... */
  code: string;
  /** The thing it is about, already named: a dock, an indexer, a connection. Never translated. */
  subject: string | null;
  detail: SetupText;
  fix: SetupText;
  url: string | null;
}

export interface SetupLink {
  label: SetupText;
  icon: string;
  url: string;
}

/** One number in the strip at the top of the page. */
export interface SetupStat {
  code: string;
  label: SetupText;
  value: number;
  tone?: "plain" | "attention";
}

/**
 * `track`: one step after another. `fan`: the first step is where books sit and the rest are
 * places they go from it, all at once rather than in turn.
 */
export const SETUP_FLOW_SHAPES = ["track", "fan"] as const;
export type SetupFlowShape = (typeof SETUP_FLOW_SHAPES)[number];

export interface SetupFlowCard {
  id: SetupFlowId;
  icon: string;
  /** Absent means `track`, so a client that predates fans still draws something sensible. */
  shape?: SetupFlowShape;
  title: SetupText;
  summary: SetupText;
  state: SetupFlowState;
  stateLabel: SetupText;
  steps: SetupStep[];
  branch: SetupBranch | null;
  /** Settings that belong to the flow but not to any one step. */
  facts: SetupText[];
  table: SetupTable | null;
  warnings: SetupWarning[];
  links: SetupLink[];
}

/* ---------- The map at the top of the page ---------- */

/** A circle on a lane, a chip feeding into one, a place books go, or a service the flows ask. */
export interface SetupMapNode {
  id: string;
  /** A Lucide icon name the page already bundles; an unknown one draws no glyph. */
  icon: string;
  label: SetupText;
  sub: SetupText | null;
}

/** The ways a book gets in, top to bottom in the order the map draws them. */
export const SETUP_MAP_LANES = ["asked", "dropped", "disk"] as const;
export type SetupMapLaneId = (typeof SETUP_MAP_LANES)[number];

/**
 * One way a book gets in: the chips it starts from and the stations it passes on its way.
 *
 * `dropped` is the Book Dock itself and is drawn as a band around its stations. A lane whose books
 * go through another lane names the station they join in `into`; otherwise they go straight to the
 * library.
 */
export interface SetupMapLane {
  id: SetupMapLaneId;
  caption: SetupText;
  entries: SetupMapNode[];
  stations: SetupMapNode[];
  /** A station id on another lane. Null means the library. */
  into: string | null;
  /** A label on the wire where the lane hands its books on. */
  note: SetupText | null;
  /** Work waiting at one of this lane's stations, drawn in the warning tone. */
  branch: { at: string; label: SetupText } | null;
}

/** A service the flows call on rather than a flow of its own, with the station that asks it. */
export interface SetupMapService extends SetupMapNode {
  /** A station id, or null for the library itself. */
  asks: string | null;
}

export interface SetupMapLibrary {
  label: SetupText;
  /** Inside the circle, under the label. */
  sub: SetupText | null;
  /** Under the circle. */
  foot: SetupText | null;
}

/** What a contributor adds to the map. The service merges the fragments. */
export interface SetupMapFragment {
  lanes?: SetupMapLane[];
  /** Where books end up, from whichever flow owns the libraries. */
  library?: SetupMapLibrary;
  out?: SetupMapNode[];
  services?: SetupMapService[];
}

export interface SetupMap {
  lanes: SetupMapLane[];
  library: SetupMapLibrary | null;
  out: SetupMapNode[];
  services: SetupMapService[];
}

export interface SetupOverview {
  generatedAt: string;
  stats: SetupStat[];
  /** In `SETUP_FLOW_IDS` order. A flow whose module is not installed is absent rather than empty. */
  cards: SetupFlowCard[];
  /** The whole server in one drawing. Null when no flow contributed to it. */
  map: SetupMap | null;
}
