export type SortDirection = 'asc' | 'desc'
export type SeriesListSort = 'name' | 'bookCount' | 'lastAddedAt' | 'readProgress'
export type SeriesBookSort = 'seriesIndex' | 'title' | 'addedAt'
export type CompletionStatus = 'not_started' | 'in_progress' | 'complete' | 'has_gaps'

/** Cards fan each series' covers; list lays them out as a sortable ledger of rows. */
export type SeriesViewMode = 'cards' | 'list'

export type SeriesGrouping = 'none' | 'letter' | 'library' | 'status'
