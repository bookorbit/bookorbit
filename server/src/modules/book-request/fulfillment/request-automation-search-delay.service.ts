import { Injectable } from '@nestjs/common';

const MIN_SEARCH_DELAY_MS = 1_000;
const MAX_SEARCH_DELAY_MS = 2_000;

@Injectable()
export class RequestAutomationSearchDelay {
  async wait(): Promise<void> {
    const durationMs = Math.floor(Math.random() * (MAX_SEARCH_DELAY_MS - MIN_SEARCH_DELAY_MS + 1)) + MIN_SEARCH_DELAY_MS;
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}
