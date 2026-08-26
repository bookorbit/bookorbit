import type { ReleaseQuery } from './indexer-adapter';

/**
 * The text handed to an indexer's keyword search.
 *
 * A request's title comes from a metadata provider, which routinely appends an edition qualifier
 * in brackets: "Project Hail Mary (Unabridged)", "Dune (Deluxe Edition)". Release names on a
 * tracker carry no such thing, and a tracker that ANDs its terms answers with nothing at all
 * rather than a worse match. Measured against MyAnonaMouse: "Project Hail Mary Andy Weir" finds
 * six releases, and the same query with "(Unabridged)" finds zero.
 *
 * The author is included because scene names carry it and it narrows hard; a tracker that
 * tokenizes loosely simply ranks it lower rather than dropping it.
 */
export function buildSearchText(query: ReleaseQuery): string {
  return [stripEditionQualifiers(query.title), query.author].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Falls back to the original title, so a wholly bracketed one does not search for nothing. */
function stripEditionQualifiers(title: string): string {
  const stripped = title
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 0 ? stripped : title.trim();
}
