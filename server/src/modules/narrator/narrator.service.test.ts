import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NarratorService } from './narrator.service';
import { NarratorRepository } from './narrator.repository';

function makeService() {
  const narratorRepo = {
    replaceForBook: vi.fn().mockResolvedValue(undefined),
  } as unknown as NarratorRepository;

  const service = new NarratorService(narratorRepo);
  return { service, narratorRepo };
}

describe('NarratorService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('replaceForBook', () => {
    it('calls repo.replaceForBook with name+sortName objects', async () => {
      const { service, narratorRepo } = makeService();

      await service.replaceForBook(42, ['Nick Podehl', 'Kate Reading']);

      expect(narratorRepo.replaceForBook).toHaveBeenCalledOnce();
      expect(narratorRepo.replaceForBook).toHaveBeenCalledWith(42, [
        { name: 'Nick Podehl', sortName: null },
        { name: 'Kate Reading', sortName: null },
      ]);
    });

    it('passes empty array when names list is empty', async () => {
      const { service, narratorRepo } = makeService();

      await service.replaceForBook(99, []);

      expect(narratorRepo.replaceForBook).toHaveBeenCalledWith(99, []);
    });

    it('preserves order of narrator names', async () => {
      const { service, narratorRepo } = makeService();

      await service.replaceForBook(1, ['First Narrator', 'Second Narrator', 'Third Narrator']);

      const [, names] = (narratorRepo.replaceForBook as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(names[0].name).toBe('First Narrator');
      expect(names[1].name).toBe('Second Narrator');
      expect(names[2].name).toBe('Third Narrator');
    });

    it('always sets sortName to null (not yet implemented)', async () => {
      const { service, narratorRepo } = makeService();

      await service.replaceForBook(1, ['Some Narrator']);

      const [, names] = (narratorRepo.replaceForBook as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(names[0].sortName).toBeNull();
    });

    it('normalizes whitespace, filters blanks, and deduplicates names case-insensitively', async () => {
      const { service, narratorRepo } = makeService();

      await service.replaceForBook(1, ['  Michael\t Kramer ', 'michael kramer', '   ', 'Kate   Reading']);

      expect(narratorRepo.replaceForBook).toHaveBeenCalledWith(1, [
        { name: 'Michael Kramer', sortName: null },
        { name: 'Kate Reading', sortName: null },
      ]);
    });

    it('normalizes object-form narrator names and sort names', async () => {
      const { service, narratorRepo } = makeService();

      await service.replaceForBook(1, [{ name: '  Simon   Vance ', sortName: ' Vance,\tSimon ' }]);

      expect(narratorRepo.replaceForBook).toHaveBeenCalledWith(1, [{ name: 'Simon Vance', sortName: 'Vance, Simon' }]);
    });
  });
});
