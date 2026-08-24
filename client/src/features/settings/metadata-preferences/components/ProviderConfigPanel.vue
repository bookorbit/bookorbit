<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookImage, BookOpen, Globe, Headphones, Loader2, RotateCcw, Save, Search } from '@lucide/vue'
import { MetadataProviderKey } from '@bookorbit/types'
import type { ProviderConfigurations, ProviderConnectionTestResult, ProviderStatus, ProviderThrottleRuntimeState } from '@bookorbit/types'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { formatList } from '@/i18n/formatters'
import { stripBearerPrefix } from '../lib/provider-token'
import { PROVIDER_GROUP_ORDER } from '../lib/provider-rows'
import type { ProviderChipView, ProviderDraftEntry, ProviderGroupId, ProviderRowDef } from '../lib/provider-rows'
import { useProviderRows } from '../composables/useProviderRows'
import ProviderRow from './ProviderRow.vue'

const { t } = useI18n()

const props = defineProps<{
  config: ProviderConfigurations | null
  statuses: ProviderStatus[]
  runtimeByKey?: Partial<Record<MetadataProviderKey, ProviderThrottleRuntimeState>>
  saving: boolean
  testingByKey?: Partial<Record<MetadataProviderKey, boolean>>
  testResultsByKey?: Partial<Record<MetadataProviderKey, ProviderConnectionTestResult>>
  passingTestSignatureByKey?: Partial<Record<MetadataProviderKey, string>>
}>()

const emit = defineEmits<{
  save: [patch: Partial<ProviderConfigurations>]
  test: [key: MetadataProviderKey, patch: Partial<ProviderConfigurations>]
}>()

type ProviderFilter = 'all' | 'enabled' | 'needsSetup'

const GROUP_ICONS: Record<ProviderGroupId, typeof BookOpen> = {
  books: BookOpen,
  audiobooks: Headphones,
  comics: BookImage,
  regional: Globe,
}

const TESTABLE_PROVIDERS: MetadataProviderKey[] = [MetadataProviderKey.AMAZON, MetadataProviderKey.HARDCOVER, MetadataProviderKey.ALADIN]

const rows = useProviderRows()
const draft = ref<ProviderConfigurations | null>(null)
const expandedKeys = ref(new Set<string>())
const search = ref('')
const filter = ref<ProviderFilter>('all')

const nowMs = ref(Date.now())
let nowTicker: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  nowTicker = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (!nowTicker) return
  clearInterval(nowTicker)
  nowTicker = null
})

watch(
  () => props.config,
  (config) => {
    if (!config) return
    draft.value = JSON.parse(JSON.stringify(config)) as ProviderConfigurations
  },
  { immediate: true },
)

/* ── Provider state ─────────────────────────────────────────────── */

function statusFor(key: string) {
  return props.statuses.find((status) => status.key === key)
}

function throttleSecondsLeft(key: string): number | null {
  const state = props.runtimeByKey?.[key as MetadataProviderKey]
  if (!state?.throttled || !state.throttledUntil) return null
  const remaining = Math.ceil((Date.parse(state.throttledUntil) - nowMs.value) / 1000)
  return remaining > 0 ? remaining : null
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}m ${seconds}s`
  }
  return `${totalSeconds}s`
}

function isTesting(key: string): boolean {
  return props.testingByKey?.[key as MetadataProviderKey] === true
}

function testResultFor(key: string): ProviderConnectionTestResult | null {
  return props.testResultsByKey?.[key as MetadataProviderKey] ?? null
}

function isTestable(key: keyof ProviderConfigurations): key is MetadataProviderKey {
  return TESTABLE_PROVIDERS.includes(key as MetadataProviderKey)
}

function currentProviderSignature(key: MetadataProviderKey): string {
  if (!draft.value) return ''
  if (key !== MetadataProviderKey.HARDCOVER) return JSON.stringify(draft.value[key] ?? null)
  return JSON.stringify({
    ...draft.value.hardcover,
    apiKey: stripBearerPrefix(draft.value.hardcover.apiKey),
  })
}

function hasPassingTestForCurrentInput(key: MetadataProviderKey): boolean {
  const expectedSignature = props.passingTestSignatureByKey?.[key]
  const result = testResultFor(key)
  if (!expectedSignature || !result || !result.ok || result.status !== 'success') return false
  return expectedSignature === currentProviderSignature(key)
}

/** Why the source cannot be switched on yet, or null when nothing stands in the way. */
function enableBlockedMessage(row: ProviderRowDef): string | null {
  if (!draft.value || !row.enableRequirement) return null
  const requirement = row.enableRequirement
  if (!requirement.isConfigured(draft.value)) return requirement.blockedMessage
  if (requirement.requiresPassingTest && !hasPassingTestForCurrentInput(row.key as MetadataProviderKey)) {
    return requirement.missingTestMessage ?? t('settings.metadata.providers.runTestBeforeEnabling')
  }
  return null
}

function isConfigured(row: ProviderRowDef): boolean {
  const status = statusFor(row.key)
  if (!status) return false
  if (row.key !== 'hardcover') return status.configured
  if (draft.value?.hardcover.enabled) return true
  return hasPassingTestForCurrentInput(MetadataProviderKey.HARDCOVER)
}

function needsSetup(row: ProviderRowDef): boolean {
  if (statusFor(row.key)) return !isConfigured(row)
  return !draft.value?.[row.key].enabled && enableBlockedMessage(row) !== null
}

/**
 * One chip per row. Throttling shows the countdown rather than the word, so the row
 * answers "when does this work again" instead of only "something is wrong".
 */
function chipFor(row: ProviderRowDef): ProviderChipView | null {
  if (!statusFor(row.key) || !draft.value) return null
  if (!isConfigured(row)) return { kind: 'setup', label: t('settings.metadata.providers.badge.setupRequired') }
  const seconds = throttleSecondsLeft(row.key)
  if (seconds !== null) {
    return {
      kind: 'throttled',
      label: formatDuration(seconds),
      title: t('settings.metadata.providers.retryIn', { duration: formatDuration(seconds) }),
    }
  }
  if (draft.value[row.key].enabled) return { kind: 'active', label: t('settings.metadata.providers.badge.active') }
  return { kind: 'ready', label: t('settings.metadata.providers.badge.ready') }
}

function providerDraft(row: ProviderRowDef): ProviderDraftEntry {
  const config = draft.value
  if (!config) return { enabled: false }
  return config[row.key] as unknown as ProviderDraftEntry
}

/* ── Filtering and grouping ─────────────────────────────────────── */

const presentRows = computed(() => {
  const config = draft.value
  if (!config) return []
  return rows.value.filter((row) => Object.prototype.hasOwnProperty.call(config, row.key))
})

const enabledCount = computed(() => presentRows.value.filter((row) => draft.value?.[row.key].enabled).length)

const filteredRows = computed(() => {
  const term = search.value.trim().toLowerCase()
  return presentRows.value.filter((row) => {
    if (filter.value === 'enabled' && !draft.value?.[row.key].enabled) return false
    if (filter.value === 'needsSetup' && !needsSetup(row)) return false
    if (!term) return true
    return `${row.label} ${row.hint ?? ''}`.toLowerCase().includes(term)
  })
})

const groups = computed(() =>
  PROVIDER_GROUP_ORDER.map((id) => ({
    id,
    icon: GROUP_ICONS[id],
    label: t(`settings.metadata.providers.groups.${id}`),
    rows: filteredRows.value.filter((row) => row.group === id),
    total: presentRows.value.filter((row) => row.group === id).length,
    enabled: presentRows.value.filter((row) => row.group === id && draft.value?.[row.key].enabled).length,
  })).filter((group) => group.rows.length > 0),
)

const FILTERS: { value: ProviderFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'settings.metadata.providers.filter.all' },
  { value: 'enabled', labelKey: 'settings.metadata.providers.filter.enabled' },
  { value: 'needsSetup', labelKey: 'settings.metadata.providers.filter.needsSetup' },
]

/* ── Unsaved changes ────────────────────────────────────────────── */

const dirtyRows = computed(() => {
  const config = props.config
  const current = draft.value
  if (!config || !current) return []
  return presentRows.value.filter((row) => JSON.stringify(current[row.key]) !== JSON.stringify(config[row.key]))
})

const dirtyNames = computed(() => formatList(dirtyRows.value.map((row) => row.label)))

/* ── Actions ────────────────────────────────────────────────────── */

function isExpanded(row: ProviderRowDef): boolean {
  return expandedKeys.value.has(row.key)
}

function setExpanded(row: ProviderRowDef, expanded: boolean) {
  const next = new Set(expandedKeys.value)
  if (expanded) next.add(row.key)
  else next.delete(row.key)
  expandedKeys.value = next
}

function toggleProvider(row: ProviderRowDef) {
  const provider = draft.value?.[row.key]
  if (!provider) return
  const blocked = provider.enabled ? null : enableBlockedMessage(row)
  if (blocked) {
    // The switch stays operable so the refusal can explain itself and open the fields
    // that would satisfy it; a plain disabled control leaves the user guessing.
    toast.error(blocked)
    setExpanded(row, true)
    return
  }
  provider.enabled = !provider.enabled
}

function updateField(row: ProviderRowDef, payload: { key: string; value: string }) {
  const provider = draft.value?.[row.key] as unknown as Record<string, unknown> | undefined
  if (!provider) return
  provider[payload.key] = payload.value
}

function testProvider(row: ProviderRowDef) {
  if (!draft.value || !isTestable(row.key)) return
  const patch = { [row.key]: { ...draft.value[row.key] } } as Partial<ProviderConfigurations>
  emit('test', row.key, patch)
}

function discard() {
  if (!props.config) return
  draft.value = JSON.parse(JSON.stringify(props.config)) as ProviderConfigurations
}

function save() {
  if (!draft.value) return
  emit('save', draft.value)
}

function setFilter(value: ProviderFilter) {
  filter.value = value
}

function clearFilters() {
  search.value = ''
  filter.value = 'all'
}
</script>

<template>
  <form @submit.prevent="save">
    <div v-if="draft">
      <div class="mb-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <p class="text-xs text-muted-foreground sm:mr-auto">
          {{ t('settings.metadata.providers.sourcesEnabled', { enabled: enabledCount, total: presentRows.length }) }}
        </p>

        <div class="relative sm:w-56">
          <Search :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            v-model="search"
            type="search"
            :placeholder="t('settings.metadata.providers.searchPlaceholder')"
            :aria-label="t('settings.metadata.providers.searchPlaceholder')"
            class="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-sm transition-shadow placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div class="flex gap-1 rounded-lg bg-muted/60 p-1" role="group" :aria-label="t('settings.metadata.providers.filter.label')">
          <button
            v-for="option in FILTERS"
            :key="option.value"
            type="button"
            :aria-pressed="filter === option.value"
            class="h-6 flex-1 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none"
            :class="
              filter === option.value
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
            "
            @click="setFilter(option.value)"
          >
            {{ t(option.labelKey) }}
          </button>
        </div>
      </div>

      <section
        v-if="groups.length"
        class="overflow-hidden rounded-lg border border-border bg-card shadow-xs"
        :aria-label="t('settings.metadata.providers.availableSources')"
      >
        <template v-for="(group, groupIndex) in groups" :key="group.id">
          <div class="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-2 md:px-5" :class="{ 'border-t': groupIndex > 0 }">
            <component :is="group.icon" :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{{ group.label }}</h3>
            <span class="ml-auto text-[11px] font-semibold tabular-nums text-muted-foreground">
              {{ t('settings.metadata.providers.groupEnabled', { enabled: group.enabled, total: group.total }) }}
            </span>
          </div>

          <ProviderRow
            v-for="(row, rowIndex) in group.rows"
            :key="row.key"
            :class="{ 'border-t border-border': rowIndex > 0 }"
            :row="row"
            :provider="providerDraft(row)"
            :chip="chipFor(row)"
            :expanded="isExpanded(row)"
            :testable="isTestable(row.key)"
            :testing="isTesting(row.key)"
            :test-result="testResultFor(row.key)"
            :blocked-message="enableBlockedMessage(row)"
            @toggle="toggleProvider(row)"
            @test="testProvider(row)"
            @update:expanded="setExpanded(row, $event)"
            @update:field="updateField(row, $event)"
          />
        </template>
      </section>

      <div v-else class="settings-empty-state">
        <p class="text-sm text-muted-foreground">{{ t('settings.metadata.providers.noMatches') }}</p>
        <Button type="button" variant="outline" size="sm" class="mt-3" @click="clearFilters">
          {{ t('settings.metadata.providers.clearFilters') }}
        </Button>
      </div>

      <div
        v-if="dirtyRows.length"
        class="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80"
      >
        <span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <p class="min-w-0 flex-1 truncate text-xs">
          <span class="font-semibold">{{ t('settings.metadata.providers.unsavedChanges', { count: dirtyRows.length }) }}</span>
          <span class="text-muted-foreground"> · {{ dirtyNames }}</span>
        </p>
        <Button type="button" variant="outline" size="sm" :disabled="saving" @click="discard">
          <RotateCcw :size="13" aria-hidden="true" />
          <span>{{ t('settings.metadata.providers.discard') }}</span>
        </Button>
        <Button type="submit" size="sm" :disabled="saving">
          <Loader2 v-if="saving" :size="13" class="animate-spin" aria-hidden="true" />
          <Save v-else :size="13" aria-hidden="true" />
          <span>{{ t('settings.metadata.providers.saveChanges') }}</span>
        </Button>
      </div>
    </div>

    <div v-else class="settings-loading-state">
      <Loader2 :size="20" class="animate-spin" aria-hidden="true" />
    </div>
  </form>
</template>
