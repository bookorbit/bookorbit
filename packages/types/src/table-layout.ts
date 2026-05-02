export type TableViewType = "library" | "smartScope" | "collection" | "series";

export type TableLayoutState = {
  columnOrder: string[];
  hiddenColumns: string[];
  columnWidths: Record<string, number>;
  pinnedColumns?: Record<string, "left" | "right" | null>;
};

export function validateTableLayout(raw: unknown, knownIds: string[]): TableLayoutState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.columnOrder) || !Array.isArray(r.hiddenColumns)) return null;
  const known = new Set(knownIds);
  const order = (r.columnOrder as unknown[]).filter((id): id is string => typeof id === "string" && known.has(id));
  const missing = knownIds.filter((id) => !order.includes(id));
  const hidden = (r.hiddenColumns as unknown[]).filter((id): id is string => typeof id === "string" && known.has(id));
  const widths: Record<string, number> = {};
  if (r.columnWidths && typeof r.columnWidths === "object") {
    for (const [id, w] of Object.entries(r.columnWidths as Record<string, unknown>)) {
      if (known.has(id) && typeof w === "number" && w > 0) widths[id] = w;
    }
  }
  const pins: Record<string, "left" | "right" | null> = {};
  if (r.pinnedColumns && typeof r.pinnedColumns === "object") {
    for (const [id, dir] of Object.entries(r.pinnedColumns as Record<string, unknown>)) {
      if (known.has(id) && (dir === "left" || dir === "right" || dir === null)) pins[id] = dir as "left" | "right" | null;
    }
  }
  return {
    columnOrder: [...order, ...missing],
    hiddenColumns: hidden,
    columnWidths: widths,
    pinnedColumns: pins,
  };
}

export function cloneTableLayout(layout: TableLayoutState): TableLayoutState {
  return {
    columnOrder: [...layout.columnOrder],
    hiddenColumns: [...layout.hiddenColumns],
    columnWidths: { ...layout.columnWidths },
    ...(layout.pinnedColumns ? { pinnedColumns: { ...layout.pinnedColumns } } : {}),
  };
}
