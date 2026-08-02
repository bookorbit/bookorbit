export const CUSTOM_METADATA_FIELD_TYPES = ["text", "url", "number", "date", "boolean"] as const;

export type CustomMetadataFieldType = (typeof CUSTOM_METADATA_FIELD_TYPES)[number];

export type CustomMetadataPrimitiveValue = string | number | boolean | null;

/** Active field id to type, resolved per query so sorting can pick the matching value column. */
export type CustomMetadataFieldTypeMap = ReadonlyMap<number, CustomMetadataFieldType>;

export interface CustomMetadataFieldDefinition {
  id: number;
  key: string;
  label: string;
  type: CustomMetadataFieldType;
  displayOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  enabledLibraryIds: number[];
  usageCount: number;
}

/** Lean summary used for table column building. Omits admin-only attributes (usageCount, timestamps). */
export interface CustomMetadataFieldSummary {
  id: number;
  label: string;
  type: CustomMetadataFieldType;
  displayOrder: number;
  archivedAt: string | null;
  enabledLibraryIds: number[];
}

export interface CustomMetadataLibraryEnablement {
  fieldId: number;
  libraryId: number;
  displayOrder: number;
}

export interface CustomMetadataBookValue {
  fieldId: number;
  key: string;
  label: string;
  type: CustomMetadataFieldType;
  displayOrder: number;
  value: CustomMetadataPrimitiveValue;
}

export interface CustomMetadataBookValueInput {
  fieldId: number;
  value: CustomMetadataPrimitiveValue;
}
