import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookCustomMetadataValues, books, customMetadataFields, customMetadataLibraryFields, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type DbExecutor = Pick<Db, 'delete' | 'insert' | 'select' | 'update'>;

@Injectable()
export class CustomMetadataRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  withTransaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx));
  }

  listFields(includeArchived = false) {
    const query = this.db.select().from(customMetadataFields);
    if (includeArchived) {
      return query.orderBy(asc(customMetadataFields.displayOrder), asc(customMetadataFields.label), asc(customMetadataFields.id));
    }
    return query
      .where(isNull(customMetadataFields.archivedAt))
      .orderBy(asc(customMetadataFields.displayOrder), asc(customMetadataFields.label), asc(customMetadataFields.id));
  }

  listEnablements() {
    return this.db
      .select({
        fieldId: customMetadataLibraryFields.fieldId,
        libraryId: customMetadataLibraryFields.libraryId,
        displayOrder: customMetadataLibraryFields.displayOrder,
      })
      .from(customMetadataLibraryFields)
      .orderBy(asc(customMetadataLibraryFields.libraryId), asc(customMetadataLibraryFields.displayOrder), asc(customMetadataLibraryFields.fieldId));
  }

  countValuesByField() {
    return this.db
      .select({ fieldId: bookCustomMetadataValues.fieldId, count: count() })
      .from(bookCustomMetadataValues)
      .groupBy(bookCustomMetadataValues.fieldId);
  }

  findActiveFieldTypes(fieldIds: number[]) {
    return this.db
      .select({ id: customMetadataFields.id, type: customMetadataFields.type })
      .from(customMetadataFields)
      .where(and(inArray(customMetadataFields.id, fieldIds), isNull(customMetadataFields.archivedAt)));
  }

  async findFieldById(fieldId: number) {
    const [row] = await this.db.select().from(customMetadataFields).where(eq(customMetadataFields.id, fieldId)).limit(1);
    return row ?? null;
  }

  async findFieldByKey(key: string) {
    const [row] = await this.db.select().from(customMetadataFields).where(eq(customMetadataFields.key, key)).limit(1);
    return row ?? null;
  }

  createField(data: typeof customMetadataFields.$inferInsert, executor: DbExecutor = this.db) {
    return executor.insert(customMetadataFields).values(data).returning();
  }

  updateField(id: number, data: Partial<typeof customMetadataFields.$inferInsert>, executor: DbExecutor = this.db) {
    return executor.update(customMetadataFields).set(data).where(eq(customMetadataFields.id, id)).returning();
  }

  async replaceEnabledLibraries(fieldId: number, libraryIds: number[], executor: DbExecutor = this.db): Promise<void> {
    await executor.delete(customMetadataLibraryFields).where(eq(customMetadataLibraryFields.fieldId, fieldId));
    if (libraryIds.length === 0) return;
    await executor.insert(customMetadataLibraryFields).values(
      libraryIds.map((libraryId, index) => ({
        fieldId,
        libraryId,
        displayOrder: index,
      })),
    );
  }

  async findLibrariesByIds(libraryIds: number[]) {
    if (libraryIds.length === 0) return [];
    return this.db.select({ id: libraries.id }).from(libraries).where(inArray(libraries.id, libraryIds));
  }

  findEnabledFieldsForLibrary(libraryId: number) {
    return this.db
      .select({
        id: customMetadataFields.id,
        key: customMetadataFields.key,
        label: customMetadataFields.label,
        type: customMetadataFields.type,
        displayOrder: customMetadataLibraryFields.displayOrder,
        archivedAt: customMetadataFields.archivedAt,
        createdAt: customMetadataFields.createdAt,
        updatedAt: customMetadataFields.updatedAt,
      })
      .from(customMetadataLibraryFields)
      .innerJoin(customMetadataFields, eq(customMetadataFields.id, customMetadataLibraryFields.fieldId))
      .where(and(eq(customMetadataLibraryFields.libraryId, libraryId), isNull(customMetadataFields.archivedAt)))
      .orderBy(asc(customMetadataLibraryFields.displayOrder), asc(customMetadataFields.label), asc(customMetadataFields.id));
  }

  findValuesForBook(bookId: number) {
    return this.db.select().from(bookCustomMetadataValues).where(eq(bookCustomMetadataValues.bookId, bookId));
  }

  findValuesForBooks(bookIds: number[]) {
    if (bookIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        bookId: bookCustomMetadataValues.bookId,
        key: customMetadataFields.key,
        label: customMetadataFields.label,
        type: customMetadataFields.type,
        valueText: bookCustomMetadataValues.valueText,
        valueNumber: bookCustomMetadataValues.valueNumber,
        valueDate: bookCustomMetadataValues.valueDate,
        valueBoolean: bookCustomMetadataValues.valueBoolean,
      })
      .from(bookCustomMetadataValues)
      .innerJoin(customMetadataFields, eq(customMetadataFields.id, bookCustomMetadataValues.fieldId))
      .innerJoin(books, eq(books.id, bookCustomMetadataValues.bookId))
      .innerJoin(
        customMetadataLibraryFields,
        and(eq(customMetadataLibraryFields.fieldId, customMetadataFields.id), eq(customMetadataLibraryFields.libraryId, books.libraryId)),
      )
      .where(and(inArray(bookCustomMetadataValues.bookId, bookIds), isNull(customMetadataFields.archivedAt)))
      .orderBy(asc(customMetadataFields.displayOrder), asc(customMetadataFields.label), asc(customMetadataFields.id));
  }

  findCardValuesForBooks(bookIds: number[]) {
    if (bookIds.length === 0) return Promise.resolve([]);
    // Drive from books so every enabled field gets a row, even if no value is stored yet.
    // This lets the frontend distinguish "enabled, no value" (entry with value=null) from
    // "not enabled for this library" (no entry at all).
    return this.db
      .select({
        bookId: books.id,
        fieldId: customMetadataFields.id,
        key: customMetadataFields.key,
        label: customMetadataFields.label,
        type: customMetadataFields.type,
        displayOrder: customMetadataLibraryFields.displayOrder,
        valueText: bookCustomMetadataValues.valueText,
        valueNumber: bookCustomMetadataValues.valueNumber,
        valueDate: bookCustomMetadataValues.valueDate,
        valueBoolean: bookCustomMetadataValues.valueBoolean,
      })
      .from(books)
      .innerJoin(customMetadataLibraryFields, eq(customMetadataLibraryFields.libraryId, books.libraryId))
      .innerJoin(customMetadataFields, and(eq(customMetadataFields.id, customMetadataLibraryFields.fieldId), isNull(customMetadataFields.archivedAt)))
      .leftJoin(
        bookCustomMetadataValues,
        and(eq(bookCustomMetadataValues.bookId, books.id), eq(bookCustomMetadataValues.fieldId, customMetadataFields.id)),
      )
      .where(inArray(books.id, bookIds))
      .orderBy(asc(customMetadataLibraryFields.displayOrder), asc(customMetadataFields.label), asc(customMetadataFields.id));
  }

  async findBookLibraryId(bookId: number) {
    const [row] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    return row?.libraryId ?? null;
  }

  deleteField(fieldId: number) {
    return this.db.delete(customMetadataFields).where(eq(customMetadataFields.id, fieldId));
  }

  async deleteValue(bookId: number, fieldId: number, executor: DbExecutor = this.db): Promise<void> {
    await executor
      .delete(bookCustomMetadataValues)
      .where(and(eq(bookCustomMetadataValues.bookId, bookId), eq(bookCustomMetadataValues.fieldId, fieldId)));
  }

  async upsertValue(
    bookId: number,
    fieldId: number,
    value: Partial<typeof bookCustomMetadataValues.$inferInsert>,
    executor: DbExecutor = this.db,
  ): Promise<void> {
    await executor
      .insert(bookCustomMetadataValues)
      .values({ bookId, fieldId, ...value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [bookCustomMetadataValues.bookId, bookCustomMetadataValues.fieldId],
        set: { ...value, updatedAt: new Date() },
      });
  }
}
