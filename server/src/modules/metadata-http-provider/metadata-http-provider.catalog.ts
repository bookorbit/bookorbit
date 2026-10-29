import { Injectable } from '@nestjs/common';
import type { ExternalMetadataProviderKey, MetadataHttpProviderInfo, MetadataHttpProviderStatus } from '@bookorbit/types';

import type { HttpProviderTarget } from './http-provider.client';

/** A registered provider as other modules see it, whether or not it is searched right now. */
export interface RegisteredHttpProvider {
  id: number;
  key: ExternalMetadataProviderKey;
  label: string;
  enabled: boolean;
  status: MetadataHttpProviderStatus;
  info: MetadataHttpProviderInfo | null;
  /** A header is saved but no longer decrypts, so the provider is left out of searches. */
  authorizationUnreadable: boolean;
  /** BookOrbit's copy of the provider's icon, versioned; null when there is none. */
  iconUrl: string | null;
  /** The provider's brand colour, `#rrggbb`, when it declares one. */
  color: string | null;
}

/** Where BookOrbit serves a provider's icon. The hash in the query changes whenever the image does. */
export function providerIconUrl(key: string, hash: string): string {
  return `/api/v1/metadata-providers/${encodeURIComponent(key)}/icon?v=${hash}`;
}

/** A provider that takes part in searches: enabled, with usable info and credentials. */
export interface ActiveHttpProvider extends RegisteredHttpProvider {
  info: MetadataHttpProviderInfo;
  target: HttpProviderTarget;
}

/**
 * The in-memory view of `metadata_http_providers` that the rest of BookOrbit reads, so a search
 * never waits on the database to learn which providers exist. Only the provider service writes it;
 * everything else reads and subscribes.
 */
@Injectable()
export class MetadataHttpProviderCatalog {
  private registeredByKey = new Map<string, RegisteredHttpProvider>();
  private activeByKey = new Map<string, ActiveHttpProvider>();
  private readonly listeners = new Set<() => void>();

  registered(): RegisteredHttpProvider[] {
    return [...this.registeredByKey.values()];
  }

  active(): ActiveHttpProvider[] {
    return [...this.activeByKey.values()];
  }

  findRegistered(key: string): RegisteredHttpProvider | undefined {
    return this.registeredByKey.get(key);
  }

  /** Called with no arguments after every change; returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replace(registered: RegisteredHttpProvider[], active: ActiveHttpProvider[]): void {
    this.registeredByKey = new Map(registered.map((provider) => [provider.key, provider]));
    this.activeByKey = new Map(active.map((provider) => [provider.key, provider]));
    for (const listener of this.listeners) listener();
  }
}
