import { chmod, mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const KEPUBIFY_BASE_URL = 'https://github.com/booklore-app/booklore-tools/raw/main/kepubify/';

@Injectable()
export class KepubifyBinaryService {
  private readonly logger = new Logger(KepubifyBinaryService.name);
  private readonly appDataPath: string;
  private cachedBinaryPath: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async getBinaryPath(): Promise<string> {
    if (this.cachedBinaryPath) return this.cachedBinaryPath;
    const binaryName = this.detectBinaryName();
    const toolsDir = join(this.appDataPath, '.tools', 'kepubify');
    const binaryPath = join(toolsDir, binaryName);
    await this.ensureBinary(binaryPath, binaryName, toolsDir);
    this.cachedBinaryPath = binaryPath;
    return binaryPath;
  }

  private detectBinaryName(): string {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === 'darwin') {
      return arch === 'arm64' ? 'kepubify-darwin-arm64' : 'kepubify-darwin-64bit';
    }
    if (platform === 'linux') {
      if (arch === 'arm64') return 'kepubify-linux-arm64';
      if (arch === 'arm') return 'kepubify-linux-arm';
      if (arch === 'x64') return 'kepubify-linux-64bit';
      return 'kepubify-linux-32bit';
    }
    throw new Error(`Unsupported platform for kepubify: ${platform} / ${arch}`);
  }

  private async ensureBinary(binaryPath: string, binaryName: string, toolsDir: string): Promise<void> {
    try {
      await stat(binaryPath);
      await chmod(binaryPath, 0o755);
      return;
    } catch {
      // Binary not cached, download it
    }

    const url = `${KEPUBIFY_BASE_URL}${binaryName}`;
    this.logger.log(`Downloading kepubify binary from ${url}`);

    await mkdir(toolsDir, { recursive: true });

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download kepubify: HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    await writeFile(binaryPath, Buffer.from(buffer));
    await chmod(binaryPath, 0o755);

    this.logger.log(`Downloaded kepubify to ${binaryPath}`);
  }
}
