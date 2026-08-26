import { computed, onScopeDispose, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { IndexerAdapterDescriptor, IndexerItem, IndexerPluginFailure, PluginInspection, PluginInstallResult } from '@bookorbit/types'

import { isBuiltInAdapter } from './useIndexerDraft'

/** A plugin row: one that failed to load, one installed but never filled in, or a working source. */
export type PluginRow =
  | { kind: 'broken'; key: string; failure: IndexerPluginFailure }
  | { kind: 'pending'; key: string; adapter: IndexerAdapterDescriptor }
  | { kind: 'source'; key: string; indexer: IndexerItem }

export interface IndexerPluginsOptions {
  indexers: Ref<IndexerItem[]>
  adapters: Ref<IndexerAdapterDescriptor[]>
  pluginFailures: Ref<IndexerPluginFailure[]>
  adapterFor: (type: string) => IndexerAdapterDescriptor | undefined
  inspectPlugin: (file: File) => Promise<{ inspection: PluginInspection | null; error?: string | null }>
  installPlugin: (file: File) => Promise<{ inspection: PluginInstallResult | null; error?: string | null }>
  removePlugin: (type: string) => Promise<boolean>
  fetchIndexers: (options?: { silent?: boolean; withAdapters?: boolean }) => Promise<void>
  /** The type currently open in the editor, so removing its plugin closes the form behind it. */
  editingType: Ref<string | null>
  cancelEdit: () => void
  /** A first install continues straight into the indexer the plugin exists to enable. */
  startCreateFor: (type: string) => void
}

/**
 * Installing, updating and removing indexer plugins, and the one list the page reads.
 *
 * A plugin and the indexer using it are two records here but one thing to the person reading the
 * page, so they are folded into a single list rather than sitting in separate sections. Everything
 * that changes what is installed also refetches, because the adapter set is what the form is
 * shaped by.
 */
export function useIndexerPlugins(options: IndexerPluginsOptions) {
  const { t } = useI18n()
  const { indexers, adapters, pluginFailures, adapterFor, inspectPlugin, installPlugin, removePlugin, fetchIndexers } = options
  const { editingType, cancelEdit, startCreateFor } = options

  const pluginInput = ref<HTMLInputElement | null>(null)
  const pluginFile = ref<File | null>(null)
  const pluginReview = ref<PluginInspection | null>(null)
  const pluginError = ref<string | null>(null)
  const pluginBusy = ref(false)
  /**
   * A plugin is normally loaded into the running server the moment it is written, so this stays off.
   * It is set only when the server reports the file landed but would not load there, which is the one
   * case a restart can still fix.
   */
  const pluginRestartPending = ref(false)
  /** Which plugin that was, so the notice can be retired once the restart has actually loaded it. */
  let restartPendingType: string | null = null
  const removingPlugin = ref<string | null>(null)
  /** The plugin whose Update entry opened the picker, so the file can be held to that type. */
  const updatingPlugin = ref<string | null>(null)
  /**
   * The plugin a removal has been asked about. A type and label are enough even when a previous
   * removal already deleted its file and left configured sources behind.
   */
  const pluginPendingRemoval = ref<{ type: string; label: string } | null>(null)

  /**
   * How many configured indexers each plugin actually backs. An installed plugin that nothing uses
   * searches nothing, and that is invisible otherwise: the row looks identical either way.
   */
  const indexerCountByType = computed(() => {
    const counts = new Map<string, number>()
    for (const indexer of indexers.value) counts.set(indexer.adapterType, (counts.get(indexer.adapterType) ?? 0) + 1)
    return counts
  })

  /**
   * One list rather than two.
   *
   * A plugin and the indexer using it are two records here but one thing to the person reading the
   * page: they carry the same name, and a plugin listed apart from the indexers reads as sitting in
   * the wrong list. So an installed plugin nothing uses appears in this list as the row it is on the
   * way to becoming, and finishing it is a step on that row rather than a different section.
   *
   * Only a plugin does this. Torznab is compiled in and always offerable, so an unconfigured torznab
   * is not an object anyone owns and would be a permanent row for a thing that does not exist.
   */
  const pluginRows = computed<PluginRow[]>(() => {
    const configured = new Set<string>()
    const rows: PluginRow[] = []

    // Failures first: a plugin that did not load is the one thing here somebody has to act on.
    for (const failure of pluginFailures.value) rows.push({ kind: 'broken', key: `broken-${failure.directory}`, failure })

    for (const indexer of indexers.value) {
      if (isBuiltInAdapter(indexer.adapterType)) continue
      configured.add(indexer.adapterType)
      rows.push({ kind: 'source', key: `source-${indexer.id}`, indexer })
    }

    for (const adapter of adapters.value) {
      if (adapter.builtIn || configured.has(adapter.type)) continue
      rows.push({ kind: 'pending', key: `pending-${adapter.type}`, adapter })
    }

    return rows
  })

  /** Torznab is the only built-in, so this group is exactly the Prowlarr and Jackett endpoints. */
  const torznabRows = computed(() => indexers.value.filter((indexer) => isBuiltInAdapter(indexer.adapterType)))

  /**
   * Nothing at all, which is what a fresh install looks like and the only state that gets its own
   * panel. A plugin that failed to load counts as something: it is the one row somebody has to act
   * on, and burying it under "no sources yet" would say the opposite.
   */
  const nothingConfigured = computed(() => pluginRows.value.length === 0 && torznabRows.value.length === 0)

  /**
   * Rows exist and not one of them is on, which searches exactly as far as having none: the rows
   * are all still on screen looking configured, so this is the one misconfiguration the list
   * cannot show by itself.
   */
  const allSourcesDisabled = computed(() => indexers.value.length > 0 && indexers.value.every((indexer) => !indexer.enabled))

  /** Every non-built-in source belongs to a plugin, including one whose plugin file is already gone. */
  const editingPluginType = computed(() => {
    const type = editingType.value
    return type && !isBuiltInAdapter(type) ? type : null
  })

  /** The loaded plugin behind the source being edited, if its file is still available. */
  const editingPlugin = computed(() => {
    if (editingPluginType.value === null) return undefined
    return adapters.value.find((adapter) => adapter.type === editingPluginType.value && !adapter.builtIn)
  })

  /** Removing the plugin also deletes every source built on it, not only the one being looked at. */
  const pluginUseCount = computed(() => indexerCountByType.value.get(editingPluginType.value ?? '') ?? 0)

  const pluginUsage = computed(() =>
    pluginUseCount.value > 0
      ? t('settings.system.requests.indexers.plugins.usedBy', { count: pluginUseCount.value })
      : t('settings.system.requests.indexers.plugins.unused'),
  )

  const pendingRemovalUsage = computed(() => indexerCountByType.value.get(pluginPendingRemoval.value?.type ?? '') ?? 0)

  function askRemovePlugin(plugin: IndexerAdapterDescriptor) {
    pluginPendingRemoval.value = { type: plugin.type, label: plugin.label }
  }

  function askRemovePluginType(type: string, label: string) {
    pluginPendingRemoval.value = { type, label }
  }

  function cancelRemovePlugin() {
    pluginPendingRemoval.value = null
  }

  function confirmRemovePlugin() {
    const plugin = pluginPendingRemoval.value
    if (plugin === null) return
    pluginPendingRemoval.value = null
    void removeInstalledPlugin(plugin.type)
  }

  /** The row hands back its adapter type; the descriptor is what the picker and the question need. */
  function handleRowPluginUpdate(type: string) {
    const adapter = adapterFor(type)
    if (adapter) startPluginUpdate(adapter)
  }

  function handleRowPluginRemove(type: string) {
    const adapter = adapterFor(type)
    const source = indexers.value.find((indexer) => indexer.adapterType === type)
    if (adapter) askRemovePlugin(adapter)
    else askRemovePluginType(type, source?.name ?? type)
  }

  function startPluginInstall() {
    updatingPlugin.value = null
    pluginInput.value?.click()
  }

  /**
   * The same picker, aimed at one plugin. Updating is installing the file again, so it goes through
   * the same inspection and the same review; what the row adds is which plugin the operator meant.
   */
  function startPluginUpdate(plugin: IndexerAdapterDescriptor) {
    updatingPlugin.value = plugin.type
    pluginInput.value?.click()
  }

  async function handlePluginChosen(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    // Cleared so choosing the same file twice still fires a change event.
    input.value = ''
    if (!file) return

    pluginFile.value = file
    pluginError.value = null
    pluginBusy.value = true
    try {
      const { inspection, error } = await inspectPlugin(file)
      if (!inspection) {
        pluginError.value = error ?? t('settings.system.requests.indexers.plugins.inspectFailed')
        toast.error(pluginError.value)
        return
      }
      // A file chosen from one plugin's Update button has to be that plugin. Without this, updating
      // LibriVox from a file that declares itself as something else quietly installs the something
      // else and leaves LibriVox untouched.
      const expected = updatingPlugin.value
      if (expected !== null && inspection.type !== expected) {
        pluginError.value = t('settings.system.requests.indexers.plugins.wrongType', { found: inspection.type, expected })
        toast.error(pluginError.value)
        return
      }

      pluginReview.value = inspection
    } finally {
      pluginBusy.value = false
    }
  }

  function cancelPluginInstall() {
    pluginReview.value = null
    pluginFile.value = null
    pluginError.value = null
    updatingPlugin.value = null
  }

  async function confirmPluginInstall() {
    const file = pluginFile.value
    if (!file) return

    pluginBusy.value = true
    try {
      const { inspection, error } = await installPlugin(file)
      if (!inspection) {
        toast.error(error ?? t('settings.system.requests.indexers.plugins.installFailed'))
        return
      }
      const { type, label, active, replaces } = inspection
      toast.success(t('settings.system.requests.indexers.plugins.installed', { label }))
      pluginRestartPending.value = !active
      restartPendingType = active ? null : type
      cancelPluginInstall()
      // Silent, or the populated panel this was started from blanks into a spinner; with adapters,
      // because the plugin is exactly what changed the adapter list.
      await fetchIndexers({ silent: true, withAdapters: true })
      // A first install continues into the indexer it exists to enable. A replacement does not: the
      // indexers using it are already configured and are not waiting on anything.
      if (active && !replaces) startCreateFor(type)
    } finally {
      pluginBusy.value = false
    }
  }

  /**
   * "Restart BookOrbit to use it" is advice the page never took back: the restart happens in a
   * terminal, and coming back to a tab that has been sitting open leaves the notice standing until
   * the whole page is reloaded. Coming back to the tab is exactly the moment to ask again.
   */
  async function recheckPluginRestart() {
    const type = restartPendingType
    if (!pluginRestartPending.value || !type) return

    await fetchIndexers({ silent: true, withAdapters: true })
    if (!adapters.value.some((adapter) => adapter.type === type)) return
    pluginRestartPending.value = false
    restartPendingType = null
  }

  function handleWindowFocus() {
    void recheckPluginRestart()
  }

  window.addEventListener('focus', handleWindowFocus)
  onScopeDispose(() => window.removeEventListener('focus', handleWindowFocus))

  async function removeInstalledPlugin(type: string) {
    removingPlugin.value = type
    try {
      const removed = await removePlugin(type)
      if (!removed) {
        toast.error(t('settings.system.requests.indexers.plugins.removeFailed'))
        return
      }
      toast.success(t('settings.system.requests.indexers.plugins.removed', { type }))
      if (editingType.value === type) cancelEdit()
      await fetchIndexers({ silent: true, withAdapters: true })
    } finally {
      removingPlugin.value = null
    }
  }

  return {
    pluginInput,
    pluginReview,
    pluginError,
    pluginBusy,
    pluginRestartPending,
    removingPlugin,
    pluginPendingRemoval,
    pluginRows,
    torznabRows,
    nothingConfigured,
    allSourcesDisabled,
    editingPluginType,
    editingPlugin,
    pluginUseCount,
    pluginUsage,
    pendingRemovalUsage,
    askRemovePlugin,
    askRemovePluginType,
    cancelRemovePlugin,
    confirmRemovePlugin,
    handleRowPluginUpdate,
    handleRowPluginRemove,
    startPluginInstall,
    startPluginUpdate,
    handlePluginChosen,
    cancelPluginInstall,
    confirmPluginInstall,
    removeInstalledPlugin,
  }
}
