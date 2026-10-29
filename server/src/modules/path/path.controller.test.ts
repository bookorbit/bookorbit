import { PathController } from './path.controller';

describe('PathController', () => {
  const pathService = {
    getConfig: vi.fn(),
    listDirectories: vi.fn(),
    createDirectory: vi.fn(),
    listFolder: vi.fn(),
    searchFolders: vi.fn(),
    getPlaces: vi.fn(),
  };
  const folderInsight = {
    summarize: vi.fn(),
    inspect: vi.fn(),
    unclaimed: vi.fn(),
    forget: vi.fn(),
  };

  const controller = new PathController(pathService as never, folderInsight as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns path config from the service', () => {
    pathService.getConfig.mockReturnValue({ root: '/books' });

    expect(controller.getConfig()).toEqual({ root: '/books' });
  });

  it('lets the service apply the default path when query path is missing', async () => {
    await controller.listDirectories(undefined as never);

    expect(pathService.listDirectories).toHaveBeenCalledWith(undefined);
  });

  it('passes provided query path through to the service', async () => {
    await controller.listDirectories('/books');

    expect(pathService.listDirectories).toHaveBeenCalledWith('/books');
  });

  it('forwards folder creation to the service and drops cached folder counts', async () => {
    pathService.createDirectory.mockResolvedValue({ name: 'scifi', path: '/books/scifi' });

    await expect(controller.createFolder({ parentPath: '/books', name: 'scifi' })).resolves.toEqual({ name: 'scifi', path: '/books/scifi' });

    expect(pathService.createDirectory).toHaveBeenCalledWith('/books', 'scifi');
    expect(folderInsight.forget).toHaveBeenCalledTimes(1);
  });

  it('keeps cached counts when folder creation fails', async () => {
    pathService.createDirectory.mockRejectedValue(new Error('exists'));

    await expect(controller.createFolder({ parentPath: '/books', name: 'scifi' })).rejects.toThrow('exists');

    expect(folderInsight.forget).not.toHaveBeenCalled();
  });

  it('passes the listing path through to the service', async () => {
    await controller.listFolder({ path: '/books' });

    expect(pathService.listFolder).toHaveBeenCalledWith('/books');
  });

  it('summarizes the requested paths in one batch', async () => {
    await controller.summarize({ paths: ['/books/a', '/books/b'] });

    expect(folderInsight.summarize).toHaveBeenCalledWith(['/books/a', '/books/b']);
  });

  it('inspects the browse root when no path is given', async () => {
    await controller.inspect({});

    expect(folderInsight.inspect).toHaveBeenCalledWith('');
  });

  it('searches system folders only when asked', async () => {
    await controller.search({ q: 'wells', path: '/books' });
    await controller.search({ q: 'usr', system: 'true' });

    expect(pathService.searchFolders).toHaveBeenNthCalledWith(1, 'wells', '/books', false);
    expect(pathService.searchFolders).toHaveBeenNthCalledWith(2, 'usr', undefined, true);
  });

  it('returns places and unclaimed folders from their services', async () => {
    pathService.getPlaces.mockResolvedValue({ root: '/', mounts: ['/books'], appDataPath: '/data', libraries: [] });
    folderInsight.unclaimed.mockResolvedValue({ folders: [], truncated: false });

    await expect(controller.places()).resolves.toEqual({ root: '/', mounts: ['/books'], appDataPath: '/data', libraries: [] });
    await expect(controller.unclaimed()).resolves.toEqual({ folders: [], truncated: false });
  });
});
