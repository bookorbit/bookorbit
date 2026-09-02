/**
 * Failures raised by the shared credential encryption used for every third-party secret this
 * feature holds - tracker API keys and download client passwords alike. They live on their own
 * rather than inside either area's list because one service raises them for both, and a settings
 * form that only knew the download-client spelling would show an indexer save failing in English.
 */
export const REQUEST_CREDENTIAL_ERROR_CODES = ["REQUEST_ENCRYPTION_KEY_MISSING", "REQUEST_ENCRYPTION_KEY_CHANGED"] as const;
export type RequestCredentialErrorCode = (typeof REQUEST_CREDENTIAL_ERROR_CODES)[number];
