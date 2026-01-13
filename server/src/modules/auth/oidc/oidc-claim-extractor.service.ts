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

    const subject = String(merged.sub ?? '');
    const username = String(merged[mapping.username] ?? merged.email ?? merged.sub ?? '');
    const name = String(merged[mapping.name] ?? merged.name ?? username);
    const email = merged[mapping.email] ? String(merged[mapping.email]) : undefined;
    const avatarUrl = merged.picture ? String(merged.picture) : undefined;

    const rawGroups = merged[mapping.groups];
    const groups = Array.isArray(rawGroups) ? rawGroups.map(String) : [];

    return { subject, username, name, email, avatarUrl, groups };
  }
}
