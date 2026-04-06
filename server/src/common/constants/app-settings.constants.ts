import type { AuthorAutoEnrichmentConfig } from '@projectx/types';

export const APP_SETTING_KEYS = {
  ALLOW_REGISTRATION: 'allow_registration',
  OPDS_ENABLED: 'opds_enabled',
  BOOK_BUCKET_AUTO_FETCH_METADATA: 'book_bucket_auto_fetch_metadata',
  BOOK_BUCKET_AUTO_FINALIZE_ENABLED: 'book_bucket_auto_finalize_enabled',
  BOOK_BUCKET_AUTO_FINALIZE_THRESHOLD: 'book_bucket_auto_finalize_threshold',
  BOOK_BUCKET_AUTO_FINALIZE_LIBRARY_ID: 'book_bucket_auto_finalize_library_id',
  BOOK_BUCKET_AUTO_FINALIZE_FOLDER_ID: 'book_bucket_auto_finalize_folder_id',
  BOOK_BUCKET_AUTO_FINALIZE_METADATA_MODE: 'book_bucket_auto_finalize_metadata_mode',
  AUTHORS_AUTO_ENRICHMENT_ENABLED: 'authors_auto_enrichment_enabled',
  AUTHORS_AUTO_ENRICHMENT_WRITE_MODE: 'authors_auto_enrichment_write_mode',
  AUTHORS_AUTO_ENRICHMENT_CONFIG: 'authors_auto_enrichment_config',
  AUTHORS_PROVIDER_AUDNEXUS_ENABLED: 'authors_provider_audnexus_enabled',
  AUTHORS_ENRICHMENT_PAUSED: 'authors_enrichment_paused',
  OIDC_CONFIG: 'oidc_config',
  UPLOAD_FILE_PATTERN: 'upload_file_pattern',
  DOWNLOAD_FILE_PATTERN: 'download_file_pattern',
  METADATA_SCORE_WEIGHTS: 'metadata_score_weights',
  AUDIT_RETENTION_DAYS: 'audit_retention_days',
  INITIAL_SETUP_COMPLETED_AT: 'initial_setup_completed_at',
} as const;

export const DEFAULT_AUDIT_RETENTION_DAYS = 90;

export interface OidcFullConfig {
  enabled: boolean;
  providerName: string;
  issuerUri: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  claimMapping: {
    username: string;
    name: string;
    email: string;
    groups: string;
  };
  autoProvision: {
    enabled: boolean;
    allowLocalLinking: boolean;
    defaultPermissionNames: string[];
  };
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
