import type { DuplicateCluster } from '@bookorbit/types'

/**
 * The server numbers clusters per page slice (`cluster-0`, `cluster-1`), so `clusterId` is neither
 * stable across refetches nor unique beyond a single page. Member ids are, so identity is derived
 * from them instead.
 */
export function clusterKey(cluster: DuplicateCluster): string {
  return cluster.entities
    .map((entity) => String(entity.id))
    .sort()
    .join('|')
}
