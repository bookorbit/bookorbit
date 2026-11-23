import type { SQL } from 'drizzle-orm';

import type { BookCard } from '@bookorbit/types';

import type { BookRepository } from './book.repository';

/**
 * Fills `linked` for cards whose book shares a group with present books the viewer can see, in one
 * query for the page. A series stack stands for several books, so it carries none. The viewer's
 * access predicate is only built when some card is linked.
 */
export async function attachCardLinks(
  repo: Pick<BookRepository, 'findLinkedBookIds' | 'findCardLinks'>,
  cards: BookCard[],
  accessWhere: () => Promise<SQL | undefined> | SQL | undefined,
): Promise<void> {
  const bookIds = cards.filter((card) => (card.collapsedSeries?.bookCount ?? 1) <= 1).map((card) => card.id);
  const linkedIds = await repo.findLinkedBookIds(bookIds);
  if (linkedIds.length === 0) return;
  const links = await repo.findCardLinks(linkedIds, await accessWhere());
  for (const card of cards) {
    const info = links.get(card.id);
    if (info) card.linked = info;
  }
}
