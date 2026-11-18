import type { SetupOverview } from '@bookorbit/types'

import { apiJson } from '@/lib/api-json'

export function getSetupOverview(signal?: AbortSignal): Promise<SetupOverview> {
  return apiJson<SetupOverview>('/api/v1/setup-overview', { signal }, 'setupOverview.error.detail')
}
