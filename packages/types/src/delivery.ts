export const READ_ALOUD_DELIVERY_VARIANTS = ["original", "audioless_epub"] as const;
export type ReadAloudDeliveryVariant = (typeof READ_ALOUD_DELIVERY_VARIANTS)[number];
export type ReadAloudDeliveryPreference = ReadAloudDeliveryVariant | null;

export interface DeliveryArtifactMetadata {
  artifactId: string;
  sourceRevision: string;
  requestedVariant: ReadAloudDeliveryPreference;
  actualVariant: ReadAloudDeliveryVariant;
  format: string;
  sizeBytes: number;
  sha256: string;
  fileHash: string;
  outcome: "original" | "verified_plain" | "stripped" | "legacy_fallback";
}
