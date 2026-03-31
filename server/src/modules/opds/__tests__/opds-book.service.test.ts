vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  count: () => ({ type: 'count' }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  inArray: (...args: unknown[]) => ({ type: 'inArray', args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values }),
}));

import * as schema from '../../../db/schema';
import { OpdsBookService } from '../opds-book.service';

function makeDbMock(whereSpy: vi.Mock) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: whereSpy,
          }),
        }),
      }),
    }),
  };
}

describe('OpdsBookService', () => {
  it('scopes file lookup by both fileId and bookId when fileId is provided', async () => {
    const whereSpy = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    });
    const db = makeDbMock(whereSpy);
    const service = new OpdsBookService(db as never, {} as never);

    await service.getBookFiles(7, 42);

    const whereArg = whereSpy.mock.calls[0][0] as { type: string; args: Array<{ type: string; left: unknown; right: unknown }> };
    expect(whereArg.type).toBe('and');
    expect(whereArg.args).toEqual([
      { type: 'eq', left: schema.bookFiles.id, right: 42 },
      { type: 'eq', left: schema.bookFiles.bookId, right: 7 },
    ]);
  });
});
