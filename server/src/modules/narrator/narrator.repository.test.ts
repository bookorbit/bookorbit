import { bookNarrators, narrators } from '../../db/schema';
import { NarratorRepository } from './narrator.repository';

function makeExecutor() {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  const narratorReturning = vi.fn();
  const narratorOnConflictDoNothing = vi.fn().mockReturnValue({ returning: narratorReturning });
  const narratorValues = vi.fn().mockReturnValue({ onConflictDoNothing: narratorOnConflictDoNothing });

  const linkOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const linkValues = vi.fn().mockReturnValue({ onConflictDoNothing: linkOnConflictDoNothing });

  const insertFn = vi.fn((table: unknown) => {
    if (table === narrators) {
      return { values: narratorValues };
    }
    if (table === bookNarrators) {
      return { values: linkValues };
    }
    throw new Error('unexpected table passed to insert');
  });

  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  return {
    executor: {
      delete: deleteFn,
      insert: insertFn,
      select: selectFn,
      update: updateFn,
    },
    deleteWhere,
    narratorValues,
    narratorReturning,
    linkValues,
    selectWhere,
    updateSet,
    updateWhere,
  };
}

function makeRepository() {
  const inner = makeExecutor();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(inner.executor));
  const db = {
    transaction,
    ...inner.executor,
  };

  return {
    repo: new NarratorRepository(db as never),
    db,
    transaction,
    ...inner,
  };
}

describe('NarratorRepository', () => {
  it('replaces narrators in a transaction and preserves first-seen display order', async () => {
    const { repo, transaction, narratorReturning, narratorValues, linkValues } = makeRepository();
    narratorReturning.mockResolvedValue([
      { id: 11, name: 'Narrator A' },
      { id: 22, name: 'Narrator B' },
    ]);

    await repo.replaceForBook(91, [
      { name: 'Narrator A', sortName: null },
      { name: 'Narrator B', sortName: 'B, Narrator' },
      { name: 'Narrator A', sortName: 'ignored duplicate' },
    ]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(narratorValues).toHaveBeenCalledWith([
      { name: 'Narrator A', sortName: null },
      { name: 'Narrator B', sortName: 'B, Narrator' },
    ]);
    expect(linkValues).toHaveBeenCalledWith([
      { bookId: 91, narratorId: 11, displayOrder: 0 },
      { bookId: 91, narratorId: 22, displayOrder: 1 },
    ]);
  });

  it('uses explicit mutation executor without opening a transaction', async () => {
    const { repo, transaction } = makeRepository();
    const external = makeExecutor();
    external.narratorReturning.mockResolvedValue([{ id: 33, name: 'Narrator C' }]);

    await repo.replaceForBook(7, [{ name: 'Narrator C', sortName: null }], external.executor as never);

    expect(transaction).not.toHaveBeenCalled();
    expect(external.narratorValues).toHaveBeenCalledWith([{ name: 'Narrator C', sortName: null }]);
    expect(external.linkValues).toHaveBeenCalledWith([{ bookId: 7, narratorId: 33, displayOrder: 0 }]);
  });

  it('only deletes existing links when narrator list is empty', async () => {
    const { repo, deleteWhere, narratorValues, linkValues } = makeRepository();

    await repo.replaceForBook(55, []);

    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(narratorValues).not.toHaveBeenCalled();
    expect(linkValues).not.toHaveBeenCalled();
  });

  it('skips unresolved narrator names that are not returned by upsert', async () => {
    const { repo, narratorReturning, linkValues } = makeRepository();
    narratorReturning.mockResolvedValue([{ id: 11, name: 'Narrator A' }]);

    await repo.replaceForBook(42, [
      { name: 'Narrator A', sortName: null },
      { name: 'Narrator B', sortName: null },
    ]);

    expect(linkValues).toHaveBeenCalledWith([{ bookId: 42, narratorId: 11, displayOrder: 0 }]);
  });

  it('canonicalizes an existing narrator with equivalent collapsed whitespace before linking it', async () => {
    const { repo, selectWhere, narratorValues, linkValues, updateSet, updateWhere } = makeRepository();
    selectWhere.mockResolvedValueOnce([{ id: 44, name: 'Narrator  A', normalizedName: 'narrator a' }]);

    await repo.replaceForBook(43, [{ name: 'Narrator A', sortName: null }]);

    expect(narratorValues).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ name: 'Narrator A' });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(linkValues).toHaveBeenCalledWith([{ bookId: 43, narratorId: 44, displayOrder: 0 }]);
  });

  it('prefers an existing clean narrator row over a legacy whitespace variant', async () => {
    const { repo, selectWhere, narratorValues, linkValues, updateSet } = makeRepository();
    selectWhere.mockResolvedValueOnce([
      { id: 44, name: 'Narrator  A', normalizedName: 'narrator a' },
      { id: 45, name: 'Narrator A', normalizedName: 'narrator a' },
    ]);

    await repo.replaceForBook(43, [{ name: 'Narrator A', sortName: null }]);

    expect(narratorValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalledWith({ name: 'Narrator A' });
    expect(linkValues).toHaveBeenCalledWith([{ bookId: 43, narratorId: 45, displayOrder: 0 }]);
  });
});
