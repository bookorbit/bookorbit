import { koboColorFromHex } from '../../annotation/annotation-style-map';

export interface KoboReadingServiceAnnotation {
  attachments: Record<string, never>;
  clientLastModifiedUtc: string;
  context: null;
  highlightColor: string;
  highlightedText: string;
  id: string;
  location: unknown;
  noteText?: string;
  type: string;
}

export interface KoboReadingServiceAnnotationsResponse {
  annotations: KoboReadingServiceAnnotation[];
  nextPageOffsetToken: null;
}

export type IncomingUpsert = {
  kind: 'upsert';
  id: string;
  deleted: boolean;
  type: string;
  color: string;
  text: string;
  note: string | null;
  chapterTitle: string | null;
  location: unknown;
  clientModifiedAt: Date;
};

export type IncomingDelete = {
  kind: 'delete';
  id: string;
  clientModifiedAt: Date;
};

export type IncomingOperation = IncomingUpsert | IncomingDelete;

/** Annotation projected from a canonical hub row into the Reading Services shape. */
export interface ServeAnnotation {
  externalKey: string;
  clientLastModifiedUtc: string;
  colorHex: string;
  text: string;
  note: string | null;
  hasNote: boolean;
  location: unknown;
}

export function toKoboReadingServiceAnnotation(row: ServeAnnotation): KoboReadingServiceAnnotation {
  return {
    attachments: {},
    clientLastModifiedUtc: row.clientLastModifiedUtc,
    context: null,
    highlightColor: koboColorFromHex(row.colorHex),
    highlightedText: row.text,
    id: row.externalKey,
    location: row.location,
    ...(row.note ? { noteText: row.note } : {}),
    type: row.hasNote ? 'note' : 'highlight',
  };
}

export function extractKoboAnnotationOperations(body: unknown): IncomingOperation[] {
  if (!isRecord(body)) return [];

  const updated = [...asArray(body.updatedAnnotations), ...asArray(body.annotations)]
    .map((value) => parseUpsert(value))
    .filter((value): value is IncomingUpsert => value !== null);

  const deleted = [
    ...extractDeletedArray(body.deletedAnnotations),
    ...extractDeletedArray(body.deletedAnnotationIds),
    ...extractDeletedArray(body.removedAnnotations),
    ...updated
      .filter((operation) => operation.deleted)
      .map((operation) => ({ kind: 'delete' as const, id: operation.id, clientModifiedAt: operation.clientModifiedAt })),
  ];

  return mergeOperations([...updated.filter((operation) => !operation.deleted), ...deleted]);
}

function parseUpsert(value: unknown): IncomingUpsert | null {
  if (!isRecord(value)) return null;
  const id = readTrimmedString(value.id);
  if (!id) return null;

  const note = readNullableString(value.noteText);
  const location = value.location ?? {};
  const type = readTrimmedString(value.type) ?? (note ? 'note' : 'highlight');
  return {
    kind: 'upsert',
    id,
    deleted: value.deleted === true || value.isDeleted === true || value.isRemoved === true || value._deleted === true,
    type,
    color: koboColorFromHex(readTrimmedString(value.highlightColor)),
    text: readString(value.highlightedText) ?? '',
    note,
    chapterTitle: readChapterTitle(location),
    location,
    clientModifiedAt: parseClientModifiedAt(value.clientLastModifiedUtc),
  };
}

function extractDeletedArray(value: unknown): IncomingDelete[] {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string' && item.trim()) {
        return { kind: 'delete' as const, id: item.trim(), clientModifiedAt: new Date() };
      }
      if (!isRecord(item)) return null;
      const id = readTrimmedString(item.id);
      if (!id) return null;
      return {
        kind: 'delete' as const,
        id,
        clientModifiedAt: parseClientModifiedAt(item.clientLastModifiedUtc ?? item.deletedAtUtc ?? item.lastModifiedUtc),
      };
    })
    .filter((item): item is IncomingDelete => item !== null);
}

function mergeOperations(operations: IncomingOperation[]): IncomingOperation[] {
  const byId = new Map<string, IncomingOperation>();
  for (const operation of operations) {
    const existing = byId.get(operation.id);
    if (!existing || operation.clientModifiedAt.getTime() >= existing.clientModifiedAt.getTime()) {
      byId.set(operation.id, operation);
    }
  }
  return [...byId.values()];
}

function readChapterTitle(location: unknown): string | null {
  if (!isRecord(location)) return null;
  const span = location.span;
  if (!isRecord(span)) return null;
  return readString(span.chapterTitle);
}

function parseClientModifiedAt(value: unknown): Date {
  const raw = readTrimmedString(value);
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function readNullableString(value: unknown): string | null {
  if (value === null) return null;
  return readString(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readTrimmedString(value: unknown): string | null {
  const raw = readString(value);
  return raw?.trim() ?? null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
