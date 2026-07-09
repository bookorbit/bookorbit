import { PathController } from './path.controller';

describe('PathController', () => {
  const pathService = {
    getConfig: vi.fn(),
    listDirectories: vi.fn(),
    createDirectory: vi.fn(),
  };

  const controller = new PathController(pathService as never);

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

  it('forwards folder creation to the service', async () => {
    await controller.createFolder({ parentPath: '/books', name: 'scifi' });

    expect(pathService.createDirectory).toHaveBeenCalledWith('/books', 'scifi');
  });
});
