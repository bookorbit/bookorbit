import { ref } from 'vue'
import type { AiConnection, AiModelList, AiOverview, AiSettings, AiUsageReport } from '@bookorbit/types'

import * as aiApi from '../api/ai.api'

export type AiLoadState = 'loading' | 'ready' | 'error'

/**
 * The AI page's state. Each section loads on its own and keeps its own state, so a failing usage
 * query never hides the connections, and the other way round.
 */
export function useAiAdmin() {
  const overview = ref<AiOverview | null>(null)
  const overviewState = ref<AiLoadState>('loading')
  const connections = ref<AiConnection[]>([])
  const connectionsState = ref<AiLoadState>('loading')
  const settings = ref<AiSettings | null>(null)
  const settingsState = ref<AiLoadState>('loading')
  /** Model lists per connection, fetched once a slot needs them. */
  const modelLists = ref<Record<number, AiModelList | 'loading' | 'error'>>({})
  /** This month's usage by feature, for each feature's spend; the tables show no monthly figure without it. */
  const monthUsage = ref<AiUsageReport | null>(null)

  async function loadOverview(): Promise<void> {
    if (!overview.value) overviewState.value = 'loading'
    try {
      overview.value = await aiApi.getOverview()
      overviewState.value = 'ready'
    } catch {
      overviewState.value = 'error'
      return
    }
    await loadMonthUsage()
  }

  async function loadMonthUsage(): Promise<void> {
    const month = overview.value?.month.month
    if (!month) return
    try {
      monthUsage.value = await aiApi.getUsage(month, month)
    } catch {
      // Spend by feature is extra detail; the totals above it come from the overview.
    }
  }

  async function loadConnections(): Promise<void> {
    if (connections.value.length === 0) connectionsState.value = 'loading'
    try {
      connections.value = await aiApi.listConnections()
      connectionsState.value = 'ready'
    } catch {
      connectionsState.value = 'error'
    }
  }

  async function loadSettings(): Promise<void> {
    if (!settings.value) settingsState.value = 'loading'
    try {
      settings.value = await aiApi.getSettings()
      settingsState.value = 'ready'
    } catch {
      settingsState.value = 'error'
    }
  }

  async function load(): Promise<void> {
    await Promise.all([loadOverview(), loadConnections(), loadSettings()])
  }

  function upsertConnection(connection: AiConnection): void {
    const index = connections.value.findIndex((entry) => entry.id === connection.id)
    if (index === -1) connections.value = [...connections.value, connection]
    else connections.value = connections.value.map((entry) => (entry.id === connection.id ? connection : entry))
    const { [connection.id]: _stale, ...rest } = modelLists.value
    modelLists.value = rest
  }

  function dropConnection(id: number): void {
    connections.value = connections.value.filter((entry) => entry.id !== id)
  }

  function applySettings(next: AiSettings): void {
    settings.value = next
    settingsState.value = 'ready'
  }

  async function ensureModels(connectionId: number, force = false): Promise<void> {
    const current = modelLists.value[connectionId]
    if (!force && current && current !== 'error') return
    modelLists.value = { ...modelLists.value, [connectionId]: 'loading' }
    try {
      const list = await aiApi.listModels(connectionId)
      modelLists.value = { ...modelLists.value, [connectionId]: list }
    } catch {
      modelLists.value = { ...modelLists.value, [connectionId]: 'error' }
    }
  }

  return {
    overview,
    overviewState,
    connections,
    connectionsState,
    settings,
    settingsState,
    modelLists,
    monthUsage,
    load,
    loadOverview,
    loadConnections,
    loadSettings,
    upsertConnection,
    dropConnection,
    applySettings,
    ensureModels,
  }
}
