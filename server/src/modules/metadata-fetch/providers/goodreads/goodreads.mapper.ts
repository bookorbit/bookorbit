import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import {
  GoodreadsApolloBook,
  GoodreadsApolloBookDetails,
  GoodreadsApolloBookSeries,
  GoodreadsApolloContributor,
  GoodreadsApolloContributorEdge,
  GoodreadsApolloGenre,
  GoodreadsApolloSeries,
  GoodreadsApolloTruncatedHtml,
  Ref,
} from './goodreads.types';

function deref<T>(state: Record<string, unknown>, ref: Ref | unknown): T | undefined {
  if (!ref || typeof ref !== 'object') return undefined;
  const r = ref as Ref;
  if (!r.__ref) return undefined;
  return state[r.__ref] as T | undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function mapGoodreadsApolloState(
  state: Record<string, unknown>,
  bookId: string,
): MetadataCandidate | null {
  const bookKey = Object.keys(state).find((k) => k.startsWith('Book:'));
  if (!bookKey) return null;
  const book = state[bookKey] as GoodreadsApolloBook;

  const details = deref<GoodreadsApolloBookDetails>(state, book.details);

  const authors: string[] = [];
  const primaryEdge = deref<GoodreadsApolloContributorEdge>(state, book.primaryContributorEdge);
  const primaryAuthor = deref<GoodreadsApolloContributor>(state, primaryEdge?.node);
  if (primaryAuthor?.name) authors.push(primaryAuthor.name);
  for (const edgeRef of book.secondaryContributorEdges ?? []) {
    const edge = deref<GoodreadsApolloContributorEdge>(state, edgeRef);
    if (edge?.role?.toLowerCase() === 'author') {
      const author = deref<GoodreadsApolloContributor>(state, edge.node);
      if (author?.name) authors.push(author.name);
    }
  }

  const descNode = deref<GoodreadsApolloTruncatedHtml>(state, book.description);
  const descHtml = descNode?.fullContent ?? descNode?.truncatedContent ?? '';
  const description = descHtml ? stripHtml(descHtml) : undefined;

  const tags: string[] = [];
  for (const entry of book.bookGenres ?? []) {
    const genre = deref<GoodreadsApolloGenre>(state, entry.genre);
    if (genre?.name) tags.push(genre.name);
  }

  let seriesName: string | undefined;
  let seriesIndex: number | undefined;
  for (const bsRef of book.bookSeries ?? []) {
    const bs = deref<GoodreadsApolloBookSeries>(state, bsRef);
    const series = deref<GoodreadsApolloSeries>(state, bs?.series);
    if (series?.title) {
      seriesName = series.title;
      if (bs?.userPosition) {
        const idx = parseFloat(bs.userPosition);
        if (!Number.isNaN(idx)) seriesIndex = idx;
      }
      break;
    }
  }

  let publishedYear: number | undefined;
  if (details?.publicationTime) {
    publishedYear = new Date(details.publicationTime).getFullYear();
  }

  const fullTitle = book.title ?? '';
  const colonIdx = fullTitle.indexOf(':');
  const title = colonIdx > 0 ? fullTitle.substring(0, colonIdx).trim() : fullTitle;
  const subtitle = colonIdx > 0 ? fullTitle.substring(colonIdx + 1).trim() : undefined;

  return {
    provider: MetadataProviderKey.GOODREADS,
    providerId: bookId,
    title,
    subtitle,
    authors: authors.length ? authors : undefined,
    description,
    publisher: details?.publisher,
    publishedYear,
    language: details?.language?.name,
    pageCount: details?.numPages,
    isbn10: details?.isbn,
    isbn13: details?.isbn13,
    tags: tags.length ? tags : undefined,
    coverUrl: book.imageUrl,
    sourceUrl: `https://www.goodreads.com/book/show/${bookId}`,
    seriesName,
    seriesIndex,
  };
}
