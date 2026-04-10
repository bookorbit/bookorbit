import { PathController } from './path.controller';

describe('PathController', () => {
  const pathService = {
    listDirectories: vi.fn(),
  };

  const controller = new PathController(pathService as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('defaults to root path when query path is missing', async () => {
    await controller.listDirectories(undefined as never);

    expect(pathService.listDirectories).toHaveBeenCalledWith('/');
  });

  it('passes provided query path through to the service', async () => {
    await controller.listDirectories('/books');

    expect(pathService.listDirectories).toHaveBeenCalledWith('/books');
  });
});
