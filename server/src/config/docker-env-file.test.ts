import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const helperPath = resolve(__dirname, '../../file-env.sh');

describe('Docker file-backed environment values', () => {
  let secretDir: string;

  beforeEach(() => {
    secretDir = mkdtempSync(join(tmpdir(), 'bookorbit-file-env-'));
  });

  afterEach(() => {
    rmSync(secretDir, { recursive: true, force: true });
  });

  it('preserves an existing direct value', () => {
    const result = runHelper('file_env JWT_SECRET; printf "%s" "$JWT_SECRET"', {
      JWT_SECRET: 'direct-secret-value',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('direct-secret-value');
  });

  it('loads a file value and removes the file variable', () => {
    const secretPath = join(secretDir, 'jwt-secret');
    writeFileSync(secretPath, '  file-secret-value  \n\n');

    const result = runHelper('file_env JWT_SECRET; printf "%s|%s" "$JWT_SECRET" "${JWT_SECRET_FILE-unset}"', {
      JWT_SECRET: '',
      JWT_SECRET_FILE: secretPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('  file-secret-value  |unset');
  });

  it.each([
    'BOOK_REQUEST_ENCRYPTION_KEY',
    'DATABASE_URL',
    'EMAIL_ENCRYPTION_KEY',
    'GITHUB_RELEASES_TOKEN',
    'JWT_SECRET',
    'MIGRATION_ENCRYPTION_KEY',
    'PODCAST_ENCRYPTION_KEY',
    'POSTGRES_PASSWORD',
    'SETUP_BOOTSTRAP_TOKEN',
  ])('loads %s from a mounted file', (name) => {
    const secretPath = join(secretDir, 'secret-value');
    writeFileSync(secretPath, `${name}-from-file`);

    const result = runHelper(`load_file_env; printf "%s" "$${name}"`, {
      [`${name}_FILE`]: secretPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${name}-from-file`);
  });

  it('rejects non-empty direct and file values together', () => {
    const secretPath = join(secretDir, 'jwt-secret');
    writeFileSync(secretPath, 'file-secret-value');

    const result = runHelper('file_env JWT_SECRET', {
      JWT_SECRET: 'direct-secret-value',
      JWT_SECRET_FILE: secretPath,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JWT_SECRET and JWT_SECRET_FILE are mutually exclusive');
  });

  it('rejects missing, empty, and oversized files without exposing their paths', () => {
    const missingPath = join(secretDir, 'missing-secret');
    const missingResult = runHelper('file_env JWT_SECRET', { JWT_SECRET_FILE: missingPath });

    expect(missingResult.status).toBe(1);
    expect(missingResult.stderr).toContain('JWT_SECRET_FILE must point to a readable regular file');
    expect(missingResult.stderr).not.toContain(missingPath);

    const emptyPath = join(secretDir, 'empty-secret');
    writeFileSync(emptyPath, '\n');
    const emptyResult = runHelper('file_env JWT_SECRET', { JWT_SECRET_FILE: emptyPath });

    expect(emptyResult.status).toBe(1);
    expect(emptyResult.stderr).toContain('JWT_SECRET_FILE points to an empty file');
    expect(emptyResult.stderr).not.toContain(emptyPath);

    const oversizedPath = join(secretDir, 'oversized-secret');
    writeFileSync(oversizedPath, 'x'.repeat(65_537));
    const oversizedResult = runHelper('file_env JWT_SECRET', { JWT_SECRET_FILE: oversizedPath });

    expect(oversizedResult.status).toBe(1);
    expect(oversizedResult.stderr).toContain('JWT_SECRET_FILE exceeds the 65536-byte limit');
  });

  it('does not leave the loaded secret in a shell variable', () => {
    const secretPath = join(secretDir, 'jwt-secret');
    writeFileSync(secretPath, 'file-secret-value');

    const result = runHelper('load_file_env; printf "%s|%s" "${file_value-unset}" "${direct_value-unset}"', {
      JWT_SECRET_FILE: secretPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('unset|unset');
  });

  it('aborts the calling script under set -e', () => {
    const secretPath = join(secretDir, 'jwt-secret');
    writeFileSync(secretPath, 'file-secret-value');

    const result = runHelper('set -e\nload_file_env\nprintf "unreachable"', {
      JWT_SECRET: 'direct-secret-value',
      JWT_SECRET_FILE: secretPath,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });
});

function runHelper(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync('sh', ['-c', '. "$1"\n' + script, 'sh', helperPath], {
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      ...env,
    },
    encoding: 'utf8',
  });
}
