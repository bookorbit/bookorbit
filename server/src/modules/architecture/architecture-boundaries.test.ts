import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(fullPath);
      return [fullPath];
    }),
  );
  return files.flat();
}

describe('Architecture boundaries', () => {
  const modulesRoot = join(process.cwd(), 'src/modules');

  it('prevents controllers from importing repositories directly', async () => {
    const allowlist = [
      'src/modules/authors/authors.controller.ts',
      'src/modules/book-metadata-fetch/book-metadata-fetch.controller.ts',
      'src/modules/book-bucket/book-bucket.controller.ts',
    ].sort();

    const allFiles = await listFilesRecursive(modulesRoot);
    const controllerFiles = allFiles.filter((file) => file.endsWith('.controller.ts'));
    const violations: string[] = [];

    for (const filePath of controllerFiles) {
      const contents = await readFile(filePath, 'utf8');
      if (/from ['"].*\.repository['"]/.test(contents)) {
        violations.push(relative(process.cwd(), filePath));
      }
    }

    expect(violations.sort()).toEqual(allowlist);
  });

  it('freezes direct DB injection in services to an explicit allowlist', async () => {
    const allowlist = [
      'src/modules/auth/auth.service.ts',
      'src/modules/auth/oidc/backchannel-logout.service.ts',
      'src/modules/auth/oidc/oidc-group-mapping.service.ts',
      'src/modules/authors/author-enrichment-config.service.ts',
      'src/modules/book/book-query-builder.service.ts',
      'src/modules/book-metadata-fetch/book-metadata-fetch-config.service.ts',
      'src/modules/catalog/catalog.service.ts',
      'src/modules/cover/cover.service.ts',
      'src/modules/kobo/services/kobo-book-access.service.ts',
      'src/modules/kobo/services/kobo-device.service.ts',
      'src/modules/kobo/services/kobo-download.service.ts',
      'src/modules/kobo/services/kobo-reading-state.service.ts',
      'src/modules/kobo/services/kobo-settings.service.ts',
      'src/modules/kobo/services/kobo-sync.service.ts',
      'src/modules/metadata/metadata.service.ts',
      'src/modules/metadata-preferences/metadata-preferences.service.ts',
      'src/modules/metadata-preferences/provider-config.service.ts',
      'src/modules/migration/planner/matching.service.ts',
      'src/modules/opds/opds-book.service.ts',
      'src/modules/opds/opds-user.service.ts',
      'src/modules/scanner/file-watcher.service.ts',
      'src/modules/seed/cleanup.service.ts',
      'src/modules/seed/seed.service.ts',
      'src/modules/book-bucket/book-bucket-finalize.service.ts',
      'src/modules/book-bucket/book-bucket.service.ts',
      'src/modules/upload/upload-processor.service.ts',
      'src/modules/upload/upload.service.ts',
    ].sort();

    const allFiles = await listFilesRecursive(modulesRoot);
    const serviceFiles = allFiles.filter((file) => file.endsWith('.service.ts'));
    const actual = (
      await Promise.all(
        serviceFiles.map(async (filePath) => {
          const contents = await readFile(filePath, 'utf8');
          return contents.includes('@Inject(DB)') ? relative(process.cwd(), filePath) : null;
        }),
      )
    )
      .filter((file): file is string => file !== null)
      .sort();

    expect(actual).toEqual(allowlist);
  });
});
