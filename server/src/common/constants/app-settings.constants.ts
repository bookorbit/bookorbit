import type { AuthorAutoEnrichmentConfig, OidcAutoProvision, OidcBaseConfig, OidcClaimMapping } from '@bookorbit/types';

export const APP_SETTING_KEYS = {
  ALLOW_REGISTRATION: 'allow_registration',
  OPDS_ENABLED: 'opds_enabled',
  BOOK_DOCK_AUTO_FETCH_METADATA: 'book_dock_auto_fetch_metadata',
  BOOK_DOCK_AUTO_FINALIZE_ENABLED: 'book_dock_auto_finalize_enabled',
  BOOK_DOCK_AUTO_FINALIZE_THRESHOLD: 'book_dock_auto_finalize_threshold',
  BOOK_DOCK_AUTO_FINALIZE_LIBRARY_ID: 'book_dock_auto_finalize_library_id',
  BOOK_DOCK_AUTO_FINALIZE_FOLDER_ID: 'book_dock_auto_finalize_folder_id',
  BOOK_DOCK_AUTO_FINALIZE_METADATA_MODE: 'book_dock_auto_finalize_metadata_mode',
  AUTHORS_AUTO_ENRICHMENT_ENABLED: 'authors_auto_enrichment_enabled',
  AUTHORS_AUTO_ENRICHMENT_WRITE_MODE: 'authors_auto_enrichment_write_mode',
  AUTHORS_AUTO_ENRICHMENT_CONFIG: 'authors_auto_enrichment_config',
  AUTHORS_PROVIDER_AUDNEXUS_ENABLED: 'authors_provider_audnexus_enabled',
  AUTHORS_ENRICHMENT_PAUSED: 'authors_enrichment_paused',
  OIDC_CONFIG: 'oidc_config',
  UPLOAD_FILE_PATTERN: 'upload_file_pattern',
  UPLOAD_FILE_PATTERN_BOOK_PER_FOLDER: 'upload_file_pattern_book_per_folder',
  DOWNLOAD_FILE_PATTERN: 'download_file_pattern',
  METADATA_SCORE_WEIGHTS: 'metadata_score_weights',
  AUDIT_RETENTION_DAYS: 'audit_retention_days',
  INITIAL_SETUP_COMPLETED_AT: 'initial_setup_completed_at',
  UPDATE_CHECK_ENABLED: 'update_check_enabled',
  HARDCOVER_ENABLED: 'hardcover_enabled',
} as const;

export const DEFAULT_AUDIT_RETENTION_DAYS = 90;

export interface OidcFullConfig extends OidcBaseConfig {
  clientSecret: string;
}

export const DEFAULT_OIDC_CONFIG: OidcFullConfig = {
  enabled: false,
  providerName: '',
  issuerUri: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
};

export const DEFAULT_CLAIM_MAPPING: OidcClaimMapping = {
  username: 'preferred_username',
  name: 'name',
  email: 'email',
  groups: 'groups',
};

export const DEFAULT_AUTO_PROVISION: OidcAutoProvision = {
  enabled: false,
  allowLocalLinking: false,
  defaultPermissionNames: [],
};

export const DEFAULT_AUTHOR_ENRICHMENT_CONFIG: AuthorAutoEnrichmentConfig = {
  enabled: false,
  triggerOnImport: true,
  writeMode: 'missing_only',
  conditions: {
    neverEnriched: true,
    missingBio: false,
    missingPhoto: false,
  },
};
