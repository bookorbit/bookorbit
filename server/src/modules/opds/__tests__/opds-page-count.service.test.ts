vi.mock('../../../common/comic-page-counter', () => ({ countComicPages: vi.fn() }));
vi.mock('../../../common/pdf-page-count', () => ({ getPdfPageCount: vi.fn() }));

import { countComicPages } from '../../../common/comic-page-counter';
import { getPdfPageCount } from '../../../common/pdf-page-count';
import { OpdsPageCountService } from '../opds-page-count.service';

const mockCountComicPages = countComicPages as MockedFunction<typeof countComicPages>;
const mockGetPdfPageCount = getPdfPageCount as MockedFunction<typeof getPdfPageCount>;

function makeService() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const db = { update };
  const service = new OpdsPageCountService(db as never);
  return { service, db, update, set, where };
}

describe('OpdsPageCountService', () => {
  it('returns the cached page count without recomputing', async () => {
    const { service, update } = makeService();
    await expect(service.ensure({ id: 1, format: 'cbz', absolutePath: '/a.cbz', pageCount: 24 })).resolves.toBe(24);
    expect(mockCountComicPages).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns null for non-streamable formats (epub) without touching the DB', async () => {
    const { service, update } = makeService();
    await expect(service.ensure({ id: 1, format: 'epub', absolutePath: '/a.epub', pageCount: null })).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('computes and persists a comic page count on first access', async () => {
    mockCountComicPages.mockResolvedValue(18);
    const { service, update, set, where } = makeService();

    await expect(service.ensure({ id: 5, format: 'cbz', absolutePath: '/a.cbz', pageCount: null })).resolves.toBe(18);
    expect(mockCountComicPages).toHaveBeenCalledWith(5, '/a.cbz', 'cbz');
    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({ pageCount: 18 });
    expect(where).toHaveBeenCalled();
  });

  it('computes and persists a pdf page count on first access', async () => {
    mockGetPdfPageCount.mockResolvedValue(200);
    const { service, set } = makeService();

    await expect(service.ensure({ id: 6, format: 'pdf', absolutePath: '/a.pdf', pageCount: null })).resolves.toBe(200);
    expect(mockGetPdfPageCount).toHaveBeenCalledWith('/a.pdf');
    expect(set).toHaveBeenCalledWith({ pageCount: 200 });
  });

  it('returns null and does not persist when counting throws (corrupt archive)', async () => {
    mockCountComicPages.mockRejectedValue(new Error('bad archive'));
    const { service, update } = makeService();

    await expect(service.ensure({ id: 7, format: 'cbr', absolutePath: '/a.cbr', pageCount: null })).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
