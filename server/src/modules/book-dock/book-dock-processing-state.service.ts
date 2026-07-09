import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { AppSettingsService } from '../app-settings/app-settings.service';

@Injectable()
export class BookDockProcessingStateService implements OnApplicationBootstrap {
  private paused = false;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly appSettings: AppSettingsService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureLoaded();
  }

  async isPaused(): Promise<boolean> {
    await this.ensureLoaded();
    return this.paused;
  }

  getCachedPaused(): boolean {
    return this.paused;
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.loaded = true;
    await this.appSettings.setBookDockPaused(true);
  }

  async resume(): Promise<void> {
    this.paused = false;
    this.loaded = true;
    await this.appSettings.setBookDockPaused(false);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.loadState();
    }
    await this.loadPromise;
  }

  private async loadState(): Promise<void> {
    try {
      this.paused = await this.appSettings.isBookDockPaused();
      this.loaded = true;
    } finally {
      this.loadPromise = null;
    }
  }
}
