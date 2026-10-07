export const METADATA_REMINDER_FIELDS = ["publisher", "language", "publication", "pageCount", "isbn", "genres", "tags", "description"] as const;

export type MetadataReminderField = (typeof METADATA_REMINDER_FIELDS)[number];

export interface MetadataReminderPreferences {
  fields: MetadataReminderField[];
}

export function normalizeMetadataReminderFields(value: unknown): MetadataReminderField[] {
  if (!Array.isArray(value)) return [...METADATA_REMINDER_FIELDS];
  return METADATA_REMINDER_FIELDS.filter((field) => value.includes(field));
}
