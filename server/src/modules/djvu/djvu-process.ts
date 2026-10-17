import { Inject, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { spawn, type ChildProcess } from 'child_process';
import { djvuConfig } from '../../config/config';
import { DJVU_LIMITS } from './djvu-container';

@Injectable()
export class DjvuProcess implements OnModuleDestroy {
  private readonly logger = new Logger(DjvuProcess.name);
  private readonly children = new Set<ChildProcess>();
  private stopped = false;

  constructor(@Inject(djvuConfig.KEY) private readonly config: ConfigType<typeof djvuConfig>) {}

  run(binary: 'ddjvu' | 'djvused', args: string[], cwd: string): Promise<string> {
    if (this.stopped) return Promise.reject(new ServiceUnavailableException('DjVu reader is stopping'));
    const limited = process.platform === 'linux';
    const executable = limited ? 'prlimit' : binary;
    const cpuSeconds = Math.ceil(this.config.timeoutMs / 1000);
    const commandArgs = limited ? ['--as=805306368', `--fsize=${DJVU_LIMITS.maxOutputBytes}`, `--cpu=${cpuSeconds}`, '--', binary, ...args] : args;
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(executable, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.add(child);
      const stdout: Buffer[] = [];
      let outputBytes = 0;
      let failed = false;
      let settled = false;
      const timeout = setTimeout(() => {
        failed = true;
        child.kill('SIGKILL');
      }, this.config.timeoutMs);
      function collect(chunk: Buffer, keep: boolean) {
        outputBytes += chunk.length;
        if (outputBytes > 1024 * 1024) {
          failed = true;
          child.kill('SIGKILL');
        } else if (keep) stdout.push(chunk);
      }
      child.stdout?.on('data', (chunk: Buffer) => collect(chunk, true));
      child.stderr?.on('data', (chunk: Buffer) => collect(chunk, false));
      const unavailable = () => {
        this.logger.warn(
          `[djvu.decode] [fail] tool=${binary} durationMs=${Date.now() - started} errorClass=SpawnError error="DjVuLibre tools are unavailable" - decoder could not start`,
        );
        reject(new ServiceUnavailableException({ code: 'DJVU_UNAVAILABLE', message: 'DjVuLibre tools are unavailable' }));
      };
      child.once('error', () => {
        settled = true;
        clearTimeout(timeout);
        this.children.delete(child);
        unavailable();
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        this.children.delete(child);
        if (settled) return;
        // prlimit exits 126 or 127 when it cannot execute the decoder, which is a missing tool, not a bad file.
        if (limited && !failed && (code === 126 || code === 127)) unavailable();
        else if (failed || code !== 0) {
          this.logger.warn(
            `[djvu.decode] [fail] tool=${binary} durationMs=${Date.now() - started} errorClass=DecodeError error="Decode failed or reached its limits" exitCode=${code} - decoder stopped`,
          );
          reject(new UnprocessableEntityException({ code: 'DJVU_DECODE_FAILED', message: 'DjVu decoding failed or exceeded its resource limits' }));
        } else resolve(Buffer.concat(stdout).toString('utf8'));
      });
    });
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const child of this.children) child.kill('SIGKILL');
  }
}
