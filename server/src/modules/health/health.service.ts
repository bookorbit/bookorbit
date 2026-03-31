import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { DATABASE_HEALTH_INDICATOR, HEALTH_ERROR_MESSAGE_MAX_LENGTH, UNKNOWN_HEALTH_ERROR_MESSAGE } from './health.constants';
import { HealthRepository } from './health.repository';

@Injectable()
export class HealthService {
  constructor(
    private readonly healthRepository: HealthRepository,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async checkDatabase(): Promise<HealthIndicatorResult<typeof DATABASE_HEALTH_INDICATOR>> {
    const databaseCheck = this.healthIndicatorService.check(DATABASE_HEALTH_INDICATOR);

    try {
      await this.healthRepository.pingDatabase();
      return databaseCheck.up();
    } catch (error) {
      return databaseCheck.down({ message: this.sanitizeErrorMessage(error) });
    }
  }

  private sanitizeErrorMessage(error: unknown): string {
    let rawMessage = '';
    if (error instanceof Error) {
      rawMessage = error.message;
    } else if (typeof error === 'string') {
      rawMessage = error;
    } else if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
      rawMessage = String(error);
    }

    const sanitized = rawMessage
      .replace(/[\r\n"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (sanitized.length === 0) return UNKNOWN_HEALTH_ERROR_MESSAGE;
    return sanitized.slice(0, HEALTH_ERROR_MESSAGE_MAX_LENGTH);
  }
}
