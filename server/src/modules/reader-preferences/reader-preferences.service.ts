import { BadRequestException, Injectable } from '@nestjs/common';

import { ReaderPreferencesRepository } from './reader-preferences.repository';

const VALID_FORMAT_GROUPS = ['epub', 'pdf', 'cbx'] as const;
type FormatGroup = (typeof VALID_FORMAT_GROUPS)[number];

function assertValidFormatGroup(formatGroup: string): asserts formatGroup is FormatGroup {
  if (!VALID_FORMAT_GROUPS.includes(formatGroup as FormatGroup)) {
    throw new BadRequestException(`Invalid format group "${formatGroup}". Must be one of: ${VALID_FORMAT_GROUPS.join(', ')}`);
  }
}

@Injectable()
export class ReaderPreferencesService {
  constructor(private readonly repo: ReaderPreferencesRepository) {}

  async getPreference(userId: number, bookFileId: number) {
    return this.repo.findPreference(userId, bookFileId);
  }

  async upsertPreference(userId: number, bookFileId: number, settings: Record<string, unknown>) {
    await this.repo.upsertPreference(userId, bookFileId, settings);
  }

  async deletePreference(userId: number, bookFileId: number) {
    await this.repo.deletePreference(userId, bookFileId);
  }

  async getAllDefaults(userId: number) {
    return this.repo.findAllDefaults(userId);
  }

  async upsertDefault(userId: number, formatGroup: string, settings: Record<string, unknown>) {
    assertValidFormatGroup(formatGroup);
    await this.repo.upsertDefault(userId, formatGroup, settings);
  }

  async deleteDefault(userId: number, formatGroup: string) {
    assertValidFormatGroup(formatGroup);
    await this.repo.deleteDefault(userId, formatGroup);
  }
}
