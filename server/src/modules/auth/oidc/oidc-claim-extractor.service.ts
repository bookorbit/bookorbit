import { Injectable } from '@nestjs/common';

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
  extract(idTokenClaims: Record<string, unknown>, userInfoClaims: Record<string, unknown>, mapping: ClaimMapping): ExtractedClaims {
    // userInfo claims take precedence over ID token claims
    const merged = { ...idTokenClaims, ...userInfoClaims };
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    const subject = str(merged.sub);
    const username = str(merged[mapping.username]) || str(merged.email) || str(merged.sub);
    const name = str(merged[mapping.name]) || str(merged.name) || username;
    const email = typeof merged[mapping.email] === 'string' ? (merged[mapping.email] as string) : undefined;
    const avatarUrl = typeof merged.picture === 'string' ? merged.picture : undefined;

    const rawGroups = merged[mapping.groups];
    const groups = Array.isArray(rawGroups) ? rawGroups.map(String) : [];

    return { subject, username, name, email, avatarUrl, groups };
  }
}
