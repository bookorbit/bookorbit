import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../../common/types/request-user';
import type { MultipartRequest } from '../../../common/types/multipart-request';
import { IndexerController } from './indexer.controller';

/**
 * The three plugin routes are the highest-privilege surface this feature has: an installed plugin
 * runs inside this process with this process's reach, including the database and the request
 * encryption key. Their gate is a hand-rolled `assertSuperuser` rather than the permission guard,
 * so nothing in the authorization matrix can see it, and until this file existed no test anywhere
 * exercised a refusal.
 */

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return { id: 1, isSuperuser: false, permissions: [], email: 'operator@example.com', ...overrides } as RequestUser;
}

/** A request whose file would parse fine, so a refusal can only have come from the gate. */
function makeUpload(): MultipartRequest {
  return {
    file: vi.fn().mockResolvedValue({
      filename: 'demo.mjs',
      file: { truncated: false },
      toBuffer: () => Promise.resolve(Buffer.from('export const type = "demo";')),
    }),
  } as unknown as MultipartRequest;
}

describe('IndexerController plugin routes', () => {
  const service = { findAll: vi.fn(), findOne: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test: vi.fn() };
  const registry = { describe: vi.fn().mockReturnValue([]) };
  const plugins = { loadFailures: vi.fn().mockReturnValue([]) };
  const pluginInstaller = { inspect: vi.fn(), install: vi.fn(), remove: vi.fn() };

  const controller = new IndexerController(service as never, registry as never, plugins as never, pluginInstaller as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gates the whole controller on ManageAppSettings', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, IndexerController)).toBe(Permission.ManageAppSettings);
  });

  describe('refuses a non-superuser who holds every permission', () => {
    // The exact account the gate exists for: an operator trusted with configuration, which is not
    // the same as being trusted to run arbitrary code in the server process.
    const operator = makeUser({ permissions: Object.values(Permission) });

    it('refuses inspect', async () => {
      const req = makeUpload();

      await expect(controller.inspectPlugin(operator, req)).rejects.toBeInstanceOf(ForbiddenException);
      // Refused before the upload is even read, so a rejected file is never parsed or buffered.
      expect(req.file).not.toHaveBeenCalled();
      expect(pluginInstaller.inspect).not.toHaveBeenCalled();
    });

    it('refuses install', async () => {
      const req = makeUpload();

      await expect(controller.installPlugin(operator, req)).rejects.toBeInstanceOf(ForbiddenException);
      expect(req.file).not.toHaveBeenCalled();
      expect(pluginInstaller.install).not.toHaveBeenCalled();
    });

    it('refuses remove', async () => {
      await expect(controller.removePlugin(operator, 'demo')).rejects.toBeInstanceOf(ForbiddenException);
      expect(pluginInstaller.remove).not.toHaveBeenCalled();
    });
  });

  describe('lets a superuser through', () => {
    const admin = makeUser({ isSuperuser: true });

    it('inspects the uploaded file', async () => {
      pluginInstaller.inspect.mockResolvedValue({ type: 'demo' });

      await expect(controller.inspectPlugin(admin, makeUpload())).resolves.toEqual({ type: 'demo' });
      expect(pluginInstaller.inspect).toHaveBeenCalledWith('export const type = "demo";');
    });

    it('installs it, attributing the install to the caller', async () => {
      pluginInstaller.install.mockResolvedValue({ type: 'demo' });

      await controller.installPlugin(makeUser({ isSuperuser: true, email: 'admin@example.com' }), makeUpload());

      expect(pluginInstaller.install).toHaveBeenCalledWith('export const type = "demo";', 'admin@example.com');
    });

    it('falls back to the user id when the account has no email to attribute to', async () => {
      pluginInstaller.install.mockResolvedValue({ type: 'demo' });

      await controller.installPlugin(makeUser({ id: 42, isSuperuser: true, email: null }), makeUpload());

      expect(pluginInstaller.install).toHaveBeenCalledWith('export const type = "demo";', 'user:42');
    });

    it('removes a plugin by type', async () => {
      pluginInstaller.remove.mockResolvedValue(undefined);

      await controller.removePlugin(admin, 'demo');

      expect(pluginInstaller.remove).toHaveBeenCalledWith('demo', 'operator@example.com');
    });
  });

  describe('validates the upload only after the gate has passed', () => {
    const admin = makeUser({ isSuperuser: true });

    it('refuses a request carrying no file', async () => {
      const req = { file: vi.fn().mockResolvedValue(undefined) } as unknown as MultipartRequest;

      await expect(controller.installPlugin(admin, req)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses anything that is not a single .mjs file', async () => {
      const req = {
        file: vi.fn().mockResolvedValue({ filename: 'plugin.zip', file: { truncated: false }, toBuffer: () => Promise.resolve(Buffer.from('')) }),
      } as unknown as MultipartRequest;

      await expect(controller.installPlugin(admin, req)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a file that hit the size cap, which arrives truncated rather than as an error', async () => {
      const req = {
        file: vi.fn().mockResolvedValue({
          filename: 'huge.mjs',
          file: { truncated: true },
          toBuffer: () => Promise.resolve(Buffer.from('export const type = "demo";')),
        }),
      } as unknown as MultipartRequest;

      await expect(controller.installPlugin(admin, req)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
