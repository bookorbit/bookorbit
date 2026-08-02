import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CustomMetadataBookValue,
  CustomMetadataFieldDefinition,
  CustomMetadataFieldSummary,
  CustomMetadataFieldType,
  CustomMetadataFieldTypeMap,
  CustomMetadataPrimitiveValue,
} from '@bookorbit/types';

import type { CustomMetadataField } from '../../db/schema';
import { CreateCustomMetadataFieldDto } from './dto/create-custom-metadata-field.dto';
import { CustomMetadataValueDto } from './dto/custom-metadata-value.dto';
import { UpdateCustomMetadataFieldDto } from './dto/update-custom-metadata-field.dto';
import { CustomMetadataRepository } from './custom-metadata.repository';

type ValueColumns = {
  valueText: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
};

@Injectable()
export class CustomMetadataService {
  constructor(private readonly repository: CustomMetadataRepository) {}

  async listFields(includeArchived = false): Promise<CustomMetadataFieldDefinition[]> {
    const [fields, enablements, usageCounts] = await Promise.all([
      this.repository.listFields(includeArchived),
      this.repository.listEnablements(),
      this.repository.countValuesByField(),
    ]);
    const enabledByFieldId = new Map<number, number[]>();
    for (const enablement of enablements) {
      const current = enabledByFieldId.get(enablement.fieldId) ?? [];
      current.push(enablement.libraryId);
      enabledByFieldId.set(enablement.fieldId, current);
    }
    const usageByFieldId = new Map(usageCounts.map((row) => [row.fieldId, row.count]));
    return fields.map((field) => this.toDefinition(field, enabledByFieldId.get(field.id) ?? [], usageByFieldId.get(field.id) ?? 0));
  }

  async listFieldSummaries(): Promise<CustomMetadataFieldSummary[]> {
    const [fields, enablements] = await Promise.all([this.repository.listFields(false), this.repository.listEnablements()]);
    const enabledByFieldId = new Map<number, number[]>();
    for (const enablement of enablements) {
      const current = enabledByFieldId.get(enablement.fieldId) ?? [];
      current.push(enablement.libraryId);
      enabledByFieldId.set(enablement.fieldId, current);
    }
    return fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      displayOrder: field.displayOrder,
      archivedAt: field.archivedAt?.toISOString() ?? null,
      enabledLibraryIds: enabledByFieldId.get(field.id) ?? [],
    }));
  }

  /** Resolves the requested field ids to their types, omitting ids that are archived or gone. */
  async getActiveFieldTypes(fieldIds: number[]): Promise<CustomMetadataFieldTypeMap> {
    if (fieldIds.length === 0) return new Map();
    const rows = await this.repository.findActiveFieldTypes(fieldIds);
    return new Map(rows.map((row) => [row.id, row.type]));
  }

  async createField(dto: CreateCustomMetadataFieldDto): Promise<CustomMetadataFieldDefinition> {
    const label = normalizeLabel(dto.label);
    const libraryIds = await this.normalizeLibraryIds(dto.enabledLibraryIds ?? []);
    const key = await this.generateUniqueKey(label);

    return this.repository.withTransaction(async (tx) => {
      const [field] = await this.repository.createField(
        {
          key,
          label,
          type: dto.type,
          displayOrder: dto.displayOrder ?? 0,
        },
        tx,
      );
      await this.repository.replaceEnabledLibraries(field.id, libraryIds, tx);
      return this.toDefinition(field, libraryIds, 0);
    });
  }

  async updateField(fieldId: number, dto: UpdateCustomMetadataFieldDto): Promise<CustomMetadataFieldDefinition> {
    const existing = await this.repository.findFieldById(fieldId);
    if (!existing || existing.archivedAt) throw new NotFoundException('Custom metadata field not found');

    const libraryIds = dto.enabledLibraryIds === undefined ? undefined : await this.normalizeLibraryIds(dto.enabledLibraryIds);
    const data: Partial<CustomMetadataField> = {};
    if (dto.label !== undefined) data.label = normalizeLabel(dto.label);
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (Object.keys(data).length > 0) data.updatedAt = new Date();

    return this.repository.withTransaction(async (tx) => {
      const [field] = Object.keys(data).length > 0 ? await this.repository.updateField(fieldId, data, tx) : [existing];
      if (libraryIds !== undefined) {
        await this.repository.replaceEnabledLibraries(fieldId, libraryIds, tx);
      }
      const enabledLibraryIds = libraryIds ?? (await this.enabledLibraryIdsForField(fieldId));
      return this.toDefinition(field, enabledLibraryIds, await this.usageCountForField(fieldId));
    });
  }

  async reorderFields(orderedIds: number[]): Promise<CustomMetadataFieldDefinition[]> {
    const uniqueIds = [...new Set(orderedIds)];
    if (uniqueIds.length !== orderedIds.length) throw new BadRequestException('Duplicate field ids in reorder request');

    const activeFields = await this.repository.listFields(false);
    const activeIds = new Set(activeFields.map((field) => field.id));
    if (uniqueIds.length !== activeIds.size || uniqueIds.some((id) => !activeIds.has(id))) {
      throw new BadRequestException('Reorder request must include every active custom metadata field exactly once');
    }

    await this.repository.withTransaction(async (tx) => {
      for (const [index, id] of uniqueIds.entries()) {
        await this.repository.updateField(id, { displayOrder: index, updatedAt: new Date() }, tx);
      }
    });

    return this.listFields(false);
  }

  async archiveField(fieldId: number): Promise<void> {
    const existing = await this.repository.findFieldById(fieldId);
    if (!existing || existing.archivedAt) throw new NotFoundException('Custom metadata field not found');
    await this.repository.updateField(fieldId, { archivedAt: new Date(), updatedAt: new Date() });
  }

  async restoreField(fieldId: number): Promise<void> {
    const existing = await this.repository.findFieldById(fieldId);
    if (!existing || !existing.archivedAt) throw new NotFoundException('Archived custom metadata field not found');
    await this.repository.updateField(fieldId, { archivedAt: null, updatedAt: new Date() });
  }

  async deleteField(fieldId: number): Promise<void> {
    const existing = await this.repository.findFieldById(fieldId);
    if (!existing) throw new NotFoundException('Custom metadata field not found');
    await this.repository.deleteField(fieldId);
  }

  async getBookValues(bookId: number, libraryId: number): Promise<CustomMetadataBookValue[]> {
    const [fields, values] = await Promise.all([this.repository.findEnabledFieldsForLibrary(libraryId), this.repository.findValuesForBook(bookId)]);
    const valueByFieldId = new Map(values.map((value) => [value.fieldId, value]));
    return fields.map((field) => {
      const stored = valueByFieldId.get(field.id);
      return {
        fieldId: field.id,
        key: field.key,
        label: field.label,
        type: field.type,
        displayOrder: field.displayOrder,
        value: stored ? valueFromColumns(stored) : null,
      };
    });
  }

  async getCardValues(bookIds: number[]): Promise<Array<CustomMetadataBookValue & { bookId: number }>> {
    if (bookIds.length === 0) return [];
    const rows = await this.repository.findCardValuesForBooks(bookIds);
    return rows.map((row) => ({
      bookId: row.bookId,
      fieldId: row.fieldId,
      key: row.key,
      label: row.label,
      type: row.type as CustomMetadataBookValue['type'],
      displayOrder: row.displayOrder,
      value: valueFromColumns(row),
    }));
  }

  async getExportValues(bookIds: number[]): Promise<Map<number, Record<string, CustomMetadataPrimitiveValue>>> {
    const rows = await this.repository.findValuesForBooks(bookIds);
    const valuesByBookId = new Map<number, Record<string, CustomMetadataPrimitiveValue>>();
    for (const row of rows) {
      const byBook = valuesByBookId.get(row.bookId) ?? {};
      byBook[`custom.${row.key}`] = valueFromColumns(row);
      valuesByBookId.set(row.bookId, byBook);
    }
    return valuesByBookId;
  }

  async updateBookValues(
    bookId: number,
    libraryId: number,
    values: CustomMetadataValueDto[],
    executor?: Parameters<CustomMetadataRepository['upsertValue']>[3],
  ) {
    if (values.length === 0) return;
    const enabledFields = await this.repository.findEnabledFieldsForLibrary(libraryId);
    const fieldById = new Map(enabledFields.map((field) => [field.id, field]));

    for (const item of values) {
      const field = fieldById.get(item.fieldId);
      if (!field) throw new BadRequestException(`Custom metadata field ${item.fieldId} is not enabled for this book`);
      const normalized = normalizeValue(field.type, item.value);
      if (normalized === null) {
        await this.repository.deleteValue(bookId, field.id, executor);
      } else {
        await this.repository.upsertValue(bookId, field.id, columnsForValue(field.type, normalized), executor);
      }
    }
  }

  async parseFileValuesForBook(bookId: number, custom: Record<string, string>): Promise<CustomMetadataValueDto[]> {
    const libraryId = await this.repository.findBookLibraryId(bookId);
    if (libraryId === null) return [];
    const fields = await this.repository.findEnabledFieldsForLibrary(libraryId);
    const values: CustomMetadataValueDto[] = [];
    for (const field of fields) {
      const raw = custom[field.key];
      if (raw === undefined) continue;
      try {
        values.push({ fieldId: field.id, value: normalizeValue(field.type, raw) });
      } catch {
        continue;
      }
    }
    return values;
  }

  private async enabledLibraryIdsForField(fieldId: number): Promise<number[]> {
    const enablements = await this.repository.listEnablements();
    return enablements.filter((enablement) => enablement.fieldId === fieldId).map((enablement) => enablement.libraryId);
  }

  private async usageCountForField(fieldId: number): Promise<number> {
    const counts = await this.repository.countValuesByField();
    return counts.find((row) => row.fieldId === fieldId)?.count ?? 0;
  }

  private async normalizeLibraryIds(libraryIds: number[]): Promise<number[]> {
    const uniqueIds = [...new Set(libraryIds)];
    if (uniqueIds.length === 0) return [];
    const rows = await this.repository.findLibrariesByIds(uniqueIds);
    const found = new Set(rows.map((row) => row.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new BadRequestException(`Unknown libraries: ${missing.join(', ')}`);
    return uniqueIds;
  }

  private async generateUniqueKey(label: string): Promise<string> {
    const base = slugifyLabel(label);
    for (let suffix = 0; suffix < 1000; suffix++) {
      const key = suffix === 0 ? base : `${base.slice(0, Math.max(1, 97 - String(suffix).length))}_${suffix}`;
      const existing = await this.repository.findFieldByKey(key);
      if (!existing) return key;
    }
    throw new BadRequestException('Unable to generate a unique custom metadata key');
  }

  private toDefinition(field: CustomMetadataField, enabledLibraryIds: number[], usageCount: number): CustomMetadataFieldDefinition {
    return {
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      displayOrder: field.displayOrder,
      archivedAt: field.archivedAt?.toISOString() ?? null,
      createdAt: field.createdAt.toISOString(),
      updatedAt: field.updatedAt.toISOString(),
      enabledLibraryIds,
      usageCount,
    };
  }
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw new BadRequestException('Custom metadata field label is required');
  return trimmed;
}

function slugifyLabel(label: string): string {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return slug || 'custom_field';
}

function normalizeValue(type: CustomMetadataFieldType, raw: unknown): CustomMetadataPrimitiveValue {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case 'text':
      return normalizeText(raw);
    case 'url':
      return normalizeUrl(raw);
    case 'number':
      return normalizeNumber(raw);
    case 'date':
      return normalizeDate(raw);
    case 'boolean':
      return normalizeBoolean(raw);
  }
}

function normalizeText(raw: unknown): string | null {
  if (typeof raw !== 'string') throw new BadRequestException('Custom metadata text values must be strings');
  const value = raw.trim();
  return value ? value : null;
}

function normalizeUrl(raw: unknown): string | null {
  const value = normalizeText(raw);
  if (value === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException('Custom metadata URL values must be valid URLs');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Custom metadata URL values must use http or https');
  }
  return parsed.toString();
}

function normalizeNumber(raw: unknown): number | null {
  if (raw === '') return null;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) throw new BadRequestException('Custom metadata number values must be finite numbers');
  return value;
}

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') throw new BadRequestException('Custom metadata date values must be YYYY-MM-DD strings');
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Custom metadata date values must be YYYY-MM-DD strings');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Custom metadata date values must be valid dates');
  }
  return value;
}

function normalizeBoolean(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new BadRequestException('Custom metadata boolean values must be booleans');
}

function columnsForValue(type: CustomMetadataFieldType, value: CustomMetadataPrimitiveValue): ValueColumns {
  return {
    valueText: type === 'text' || type === 'url' ? (value as string) : null,
    valueNumber: type === 'number' ? (value as number) : null,
    valueDate: type === 'date' ? (value as string) : null,
    valueBoolean: type === 'boolean' ? (value as boolean) : null,
  };
}

function valueFromColumns(columns: ValueColumns): CustomMetadataPrimitiveValue {
  return columns.valueText ?? columns.valueNumber ?? columns.valueDate ?? columns.valueBoolean ?? null;
}
