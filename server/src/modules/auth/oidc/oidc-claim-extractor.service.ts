import { Injectable, Logger } from '@nestjs/common';

export interface ExtractedClaims {
  subject: string;
  username: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  groups: string[];
}

export interface ClaimMapping {
  username: string;
  name: string;
  email: string;
  groups: string;
}

@Injectable()
export class OidcClaimExtractorService {
  private readonly logger = new Logger(OidcClaimExtractorService.name);

  extract(idTokenClaims: Record<string, unknown>, userInfoClaims: Record<string, unknown>, mapping: ClaimMapping): ExtractedClaims {
    // userInfo claims take precedence over ID token claims
    const merged = { ...idTokenClaims, ...userInfoClaims };
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    const subject = str(merged.sub);

    const rawUsername = str(merged[mapping.username]);
    const username = rawUsername || str(merged.email) || str(merged.sub);
    if (!rawUsername && username) {
      this.logger.warn(
        `[auth.oidc_claim_extract] configured username claim "${mapping.username}" missing; fell back to "${!str(merged.email) ? 'sub' : 'email'}"`,
      );
    }

    const rawName = str(merged[mapping.name]);
    const name = rawName || str(merged.name) || username;
    if (!rawName && name) {
      this.logger.warn(
        `[auth.oidc_claim_extract] configured name claim "${mapping.name}" missing; fell back to "${!str(merged.name) ? 'username' : 'name'}"`,
      );
    }

    const email = typeof merged[mapping.email] === 'string' ? (merged[mapping.email] as string) : undefined;
    if (!email && mapping.email) {
      this.logger.warn(`[auth.oidc_claim_extract] configured email claim "${mapping.email}" missing or not a string`);
    }

    const avatarUrl = typeof merged.picture === 'string' ? merged.picture : undefined;

    const rawGroups = merged[mapping.groups];
    const groups = Array.isArray(rawGroups) ? rawGroups.map(String) : [];

    return { subject, username, name, email, avatarUrl, groups };
  }
}
