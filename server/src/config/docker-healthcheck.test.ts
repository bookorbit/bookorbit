import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dockerfile = readFileSync(resolve(__dirname, '../../../Dockerfile'), 'utf8');
const healthcheck = dockerfile.match(/HEALTHCHECK[^\n]*\\\n\s*CMD ([\s\S]*?)(?:\n\n|$)/)?.[1].replace(/\\\n/g, '\n');

describe('Docker healthcheck bind address', () => {
  it.each([
    { host: undefined, port: undefined, expected: '127.0.0.1:3000' },
    { host: '', port: '', expected: '127.0.0.1:3000' },
    { host: '   ', port: '31015', expected: '127.0.0.1:31015' },
    { host: '0.0.0.0', port: '31015', expected: '127.0.0.1:31015' },
    { host: '127.0.0.1', port: '31015', expected: '127.0.0.1:31015' },
    { host: ' 192.0.2.10 ', port: '31015', expected: '192.0.2.10:31015' },
    { host: '::', port: '31015', expected: '[::1]:31015' },
    { host: '::1', port: '31015', expected: '[::1]:31015' },
    { host: '2001:db8::1', port: '31015', expected: '[2001:db8::1]:31015' },
  ])('probes $expected with HOST=$host and PORT=$port', ({ host, port, expected }) => {
    expect(healthcheck).toBeDefined();
    const env = { ...process.env };
    delete env.HOST;
    delete env.PORT;
    if (host !== undefined) env.HOST = host;
    if (port !== undefined) env.PORT = port;

    const args = execFileSync('sh', ['-c', `wget() { printf '%s\\n' "$@"; }\n${healthcheck}`], { env, encoding: 'utf8' })
      .trim()
      .split('\n');

    expect(args).toEqual(['-q', '-T', '4', '-O', '/dev/null', `http://${expected}/api/v1/health`]);
  });

  it('propagates a failed HTTP probe to Docker', () => {
    expect(healthcheck).toBeDefined();
    expect(() => execFileSync('sh', ['-c', `wget() { return 1; }\n${healthcheck}`])).toThrow();
  });
});
