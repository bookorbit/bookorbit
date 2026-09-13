import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IndexerPlugin, PluginUpdateManifest } from '@bookorbit/plugin-api';

import { safeFetch } from '../../../../common/utils/safe-fetch';
import { PluginIndexerAdapter } from './plugin-host';
import { compareVersions, PluginUpdateService } from './plugin-update.service';

vi.mock('../../../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));

const MANIFEST_URL = 'https://updates.example/plugin.json';
const SOURCE_URL = 'https://updates.example/index.mjs';
const SOURCE = `export default { apiVersion: 1, version: '1.1.0', type: 'demo' };\n`;

describe('PluginUpdateService', () => {
  let root: string;
  let service: PluginUpdateService;
  let plugin: IndexerPlugin;
  let registry: { all: () => PluginIndexerAdapter[]; find: (type: string) => PluginIndexerAdapter | undefined };
  let loader: { root: string; directoryForType: (type: string) => string | undefined };
  let installer: { inspect: ReturnType<typeof vi.fn>; installVerifiedUpdate: ReturnType<typeof vi.fn> };
  let manifest: PluginUpdateManifest;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-plugin-update-'));
    await mkdir(join(root, 'demo'));
    await writeFile(join(root, 'demo', 'index.mjs'), `export default { version: '1.0.0' };\n`);

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicJwk = publicKey.export({ format: 'jwk' });
    plugin = {
      apiVersion: 1,
      version: '1.0.0',
      type: 'demo',
      label: 'Demo',
      requiresCredential: false,
      credentialKind: null,
      mediaKinds: ['ebook'],
      usesCategories: false,
      seedsBack: false,
      update: { manifestUrl: MANIFEST_URL, ed25519PublicKey: publicJwk.x! },
      search: vi.fn(),
      test: vi.fn(),
      resolveFile: vi.fn(),
    };
    manifest = {
      schemaVersion: 1,
      type: 'demo',
      version: '1.1.0',
      sourceUrl: SOURCE_URL,
      sha256: await digest(SOURCE),
      signature: sign(null, Buffer.from(SOURCE), privateKey).toString('base64'),
    };

    const adapter = new PluginIndexerAdapter(plugin, {} as never);
    registry = { all: () => [adapter], find: (type: string) => (type === 'demo' ? adapter : undefined) };
    loader = { root, directoryForType: (type: string) => (type === 'demo' ? 'demo' : undefined) };
    installer = {
      inspect: vi.fn().mockResolvedValue({
        type: 'demo',
        label: 'Demo',
        version: '1.1.0',
        requiresCredential: false,
        credentialKind: null,
        mediaKinds: ['ebook'],
        usesCategories: false,
        seedsBack: false,
        settingsFields: [],
        source: SOURCE,
        replaces: true,
      }),
      installVerifiedUpdate: vi.fn().mockResolvedValue({ type: 'demo', label: 'Demo', version: '1.1.0', active: true }),
    };
    service = new PluginUpdateService(registry as never, loader as never, installer as never);
    vi.mocked(safeFetch).mockReset();
    vi.mocked(safeFetch).mockImplementation((url) => {
      if (url === MANIFEST_URL) return Promise.resolve(new Response(JSON.stringify(manifest), { headers: { ETag: '"one"' } }));
      if (url === SOURCE_URL) return Promise.resolve(new Response(SOURCE));
      return Promise.reject(new Error(`unexpected URL ${url}`));
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('checks one small signed manifest and reports a newer version', async () => {
    await expect(service.checkOne('demo')).resolves.toMatchObject({
      type: 'demo',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      state: 'available',
      autoUpdate: false,
    });
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it('revalidates a cached manifest with its ETag', async () => {
    await service.checkOne('demo');
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response(null, { status: 304 }));

    await expect(service.checkOne('demo')).resolves.toMatchObject({ state: 'available', latestVersion: '1.1.0' });
    expect(safeFetch).toHaveBeenLastCalledWith(
      MANIFEST_URL,
      expect.objectContaining({ headers: expect.objectContaining({ 'If-None-Match': '"one"' }) }),
      { pinResolvedAddress: true },
    );
  });

  it('stops after the configured number of redirects', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(null, { status: 302, headers: { Location: '/again' } }));

    await expect(service.checkOne('demo')).resolves.toMatchObject({ state: 'failed', error: expect.stringContaining('redirected') });
    expect(safeFetch).toHaveBeenCalledTimes(4);
  });

  it('downloads, verifies and inspects source before review', async () => {
    const review = await service.inspect('demo');

    expect(review).toMatchObject({ type: 'demo', version: '1.1.0', currentVersion: '1.0.0', verified: true, sha256: manifest.sha256 });
    expect(installer.inspect).toHaveBeenCalledWith(SOURCE);
  });

  it('refuses source whose publisher signature is invalid', async () => {
    manifest.signature = Buffer.alloc(64).toString('base64');

    await expect(service.inspect('demo')).rejects.toThrow('valid publisher signature');
    expect(installer.inspect).not.toHaveBeenCalled();
  });

  it('installs immediately when signed automatic updates are enabled', async () => {
    const status = await service.setAutomatic('demo', true);

    expect(installer.installVerifiedUpdate).toHaveBeenCalledWith(SOURCE, 'demo', 'system:auto-update');
    expect(status).toMatchObject({ state: 'current', currentVersion: '1.1.0', autoUpdate: true });
  });

  it('keeps automatic-update consent across service instances', async () => {
    await service.setAutomatic('demo', true);
    const restarted = new PluginUpdateService(registry as never, loader as never, installer as never);

    await expect(restarted.list()).resolves.toEqual([expect.objectContaining({ type: 'demo', autoUpdate: true })]);
  });

  it('requires the reviewed digest when a person confirms an update', async () => {
    await expect(service.apply('demo', '0'.repeat(64), 'operator@example.com')).rejects.toThrow('changed after it was reviewed');
    expect(installer.installVerifiedUpdate).not.toHaveBeenCalled();
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0-beta', 1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['2.0.0+first', '2.0.0+second', 0],
  ])('orders %s against %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });
});

async function digest(source: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(source).digest('hex');
}
