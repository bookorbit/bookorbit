import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

import type { AppInfoResponse } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { GITHUB_RELEASES_API, SEMVER_RE, UPDATE_CHECK_TIMEOUT_MS } from './app-info.constants';

@Injectable()
export class AppInfoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppInfoService.name);
  private updateAvailable: boolean | null = null;
  private latestVersion: string | null = null;
  private lastCheckTime = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly appSettingsService: AppSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const version = this.config.get<string>('app.version') ?? 'Local build';
    const enabled = await this.appSettingsService.isUpdateCheckEnabled();

    if (!enabled || !SEMVER_RE.test(version)) {
      return;
    }

    this.lastCheckTime = Date.now();
    await this.checkForUpdate(version);
  }

  async getAppInfo(): Promise<AppInfoResponse> {
    const version = this.config.get<string>('app.version') ?? 'Local build';
    const enabled = await this.appSettingsService.isUpdateCheckEnabled();
    const appDataPath = this.config.get<string>('storage.appDataPath') ?? '/data';

    if (enabled && SEMVER_RE.test(version)) {
      const now = Date.now();
      if (now - this.lastCheckTime > 600_000) {
        this.lastCheckTime = now;
        await this.checkForUpdate(version);
      }
    }

    return {
      version,
      updateAvailable: this.updateAvailable,
      latestVersion: this.latestVersion,
      bookDockPath: join(appDataPath, 'book-dock'),
    };
  }

  private async checkForUpdate(currentVersion: string): Promise<void> {
    const start = Date.now();
    this.logger.log(`[app-info.update_check] [start] version=${currentVersion} - checking for updates`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(GITHUB_RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const durationMs = Date.now() - start;
        this.logger.warn(
          `[app-info.update_check] [fail] version=${currentVersion} durationMs=${durationMs} errorClass=HttpError error="GitHub API returned ${response.status}" - update check failed`,
        );
        return;
      }

      const data: unknown = await response.json();
      const tagName = this.extractTagName(data);

      if (!tagName) {
        const durationMs = Date.now() - start;
        this.logger.warn(
          `[app-info.update_check] [fail] version=${currentVersion} durationMs=${durationMs} errorClass=ParseError error="unexpected response shape" - update check failed`,
        );
        return;
      }

      this.latestVersion = tagName;
      this.updateAvailable = this.isNewer(tagName, currentVersion);

      const durationMs = Date.now() - start;
      this.logger.log(
        `[app-info.update_check] [end] version=${currentVersion} latestVersion=${tagName} updateAvailable=${this.updateAvailable} durationMs=${durationMs} - update check completed`,
      );
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[app-info.update_check] [fail] version=${currentVersion} durationMs=${durationMs} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - update check failed`,
      );
    }
  }

  private extractTagName(data: unknown): string | null {
    if (typeof data !== 'object' || data === null) return null;
    const record = data as Record<string, unknown>;
    const tagName = record['tag_name'];
    if (typeof tagName !== 'string' || !SEMVER_RE.test(tagName)) return null;
    return tagName;
  }

  private isNewer(latestTag: string, currentVersion: string): boolean {
    const latest = this.parseSemver(latestTag.replace(/^v/, ''));
    const current = this.parseSemver(currentVersion.replace(/^v/, ''));
    if (!latest || !current) return false;
    if (latest[0] !== current[0]) return latest[0] > current[0];
    if (latest[1] !== current[1]) return latest[1] > current[1];
    return latest[2] > current[2];
  }

  private parseSemver(version: string): [number, number, number] | null {
    const parts = version.split('.').map(Number);
    if (parts.length < 3 || parts.some((p) => isNaN(p))) return null;
    return [parts[0], parts[1], parts[2]];
  }
}
