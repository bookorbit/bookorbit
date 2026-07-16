<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Save } from '@lucide/vue'
import { MetadataProviderKey } from '@bookorbit/types'
import type { ProviderConfigurations, ProviderConnectionTestResult, ProviderStatus, ProviderThrottleRuntimeState } from '@bookorbit/types'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { stripBearerPrefix } from '../lib/provider-token'

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

const draft = ref<ProviderConfigurations | null>(null)
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
  (c) => {
    if (!c) return
    draft.value = JSON.parse(JSON.stringify(c)) as ProviderConfigurations
  },
  { immediate: true },
)

const AMAZON_DOMAINS = [
  'amazon.com',
  'amazon.co.uk',
  'amazon.de',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.ca',
  'amazon.com.au',
  'amazon.co.jp',
  'amazon.in',
  'amazon.com.br',
  'amazon.com.mx',
  'amazon.nl',
  'amazon.se',
  'amazon.pl',
  'amazon.sg',
  'amazon.ae',
  'amazon.sa',
  'amazon.tr',
]

const AUDIBLE_DOMAINS = [
  'audible.com',
  'audible.co.uk',
  'audible.de',
  'audible.fr',
  'audible.it',
  'audible.es',
  'audible.ca',
  'audible.com.au',
  'audible.co.jp',
  'audible.in',
]

const KOBO_COUNTRIES = ['us', 'ca', 'gb', 'au', 'nz', 'de', 'fr', 'it', 'es', 'nl', 'pt', 'br', 'jp']
const KOBO_LANGUAGES = ['en', 'fr', 'de', 'it', 'es', 'nl', 'pt', 'ja', 'all']

type FieldDef = {
  key: string
  label: string
  type: 'text' | 'password' | 'select'
  options?: string[]
  placeholder?: string
  helper?: string
  alwaysEditable?: boolean
  widthClass?: string
}

type RowDef = {
  key: keyof ProviderConfigurations
  label: string
  hint?: string
  fields: FieldDef[]
  enableRequirement?: {
    isConfigured: (config: ProviderConfigurations) => boolean
    blockedMessage: string
    requiresPassingTest?: boolean
    missingTestMessage?: string
  }
}

const rows = computed<RowDef[]>(() => [
  {
    key: 'google',
    label: 'Google Books',
    hint: t('settings.metadata.providers.hints.google'),
    fields: [
      {
        key: 'apiKey',
        label: t('settings.metadata.providers.fields.apiKey'),
        type: 'password',
        placeholder: 'AIza...',
        helper: t('settings.metadata.providers.helpers.googleApiKey'),
        alwaysEditable: true,
      },
    ],
    enableRequirement: {
      isConfigured: (c) => !!c.google.apiKey.trim(),
      blockedMessage: t('settings.metadata.providers.blocked.google'),
    },
  },
  {
    key: 'amazon',
    label: 'Amazon',
    hint: t('settings.metadata.providers.hints.amazon'),
    fields: [
      {
        key: 'domain',
        label: t('settings.metadata.providers.fields.region'),
        type: 'select',
        options: AMAZON_DOMAINS,
        widthClass: 'md:w-[6.75rem] md:min-w-[6.75rem]',
      },
      {
        key: 'cookie',
        label: t('settings.metadata.providers.fields.cookie'),
        type: 'password',
        placeholder: 'session-id=...; ubid-main=...; x-main=...',
      },
    ],
  },
  { key: 'goodreads', label: 'Goodreads', hint: t('settings.metadata.providers.hints.goodreads'), fields: [] },
  {
    key: 'hardcover',
    label: 'Hardcover',
    hint: t('settings.metadata.providers.hints.hardcover'),
    fields: [{ key: 'apiKey', label: t('settings.metadata.providers.fields.apiKey'), type: 'password', placeholder: 'eyJ...', alwaysEditable: true }],
    enableRequirement: {
      isConfigured: (c) => !!c.hardcover.apiKey.trim(),
      blockedMessage: t('settings.metadata.providers.blocked.hardcover'),
      requiresPassingTest: true,
      missingTestMessage: t('settings.metadata.providers.blocked.hardcoverTest'),
    },
  },
  { key: 'openLibrary', label: 'Open Library', hint: t('settings.metadata.providers.hints.openLibrary'), fields: [] },
  {
    key: 'itunes',
    label: 'iTunes',
    hint: t('settings.metadata.providers.hints.itunes'),
    fields: [
      { key: 'coverResolution', label: t('settings.metadata.providers.fields.coverResolution'), type: 'select', options: ['high', 'standard'] },
    ],
  },
  {
    key: 'kobo',
    label: 'Kobo',
    hint: t('settings.metadata.providers.hints.kobo'),
    fields: [
      {
        key: 'country',
        label: t('settings.metadata.providers.fields.country'),
        type: 'select',
        options: KOBO_COUNTRIES,
        alwaysEditable: true,
        widthClass: 'md:w-[5.25rem] md:min-w-[5.25rem]',
      },
      {
        key: 'language',
        label: t('settings.metadata.providers.fields.language'),
        type: 'select',
        options: KOBO_LANGUAGES,
        alwaysEditable: true,
        widthClass: 'md:w-[5.25rem] md:min-w-[5.25rem]',
      },
    ],
  },
  {
    key: 'audible',
    label: 'Audible',
    hint: t('settings.metadata.providers.hints.audible'),
    fields: [{ key: 'domain', label: t('settings.metadata.providers.fields.region'), type: 'select', options: AUDIBLE_DOMAINS }],
  },
  { key: 'audnexus', label: 'AudNexus', hint: t('settings.metadata.providers.hints.audnexus'), fields: [] },
  {
    key: 'librofm',
    label: 'Libro.fm',
    hint: 'DRM-free audiobook catalog metadata. Uses an undocumented Libro.fm endpoint and is disabled by default.',
    fields: [],
  },
  {
    key: 'comicvine',
    label: 'ComicVine',
    hint: t('settings.metadata.providers.hints.comicvine'),
    fields: [{ key: 'apiKey', label: t('settings.metadata.providers.fields.apiKey'), type: 'password', alwaysEditable: true }],
    enableRequirement: {
      isConfigured: (c) => !!c.comicvine.apiKey.trim(),
      blockedMessage: t('settings.metadata.providers.blocked.comicvine'),
    },
  },
  { key: 'ranobedb', label: 'RanobeDB', hint: t('settings.metadata.providers.hints.ranobedb'), fields: [] },
  {
    key: 'lubimyczytac',
    label: 'LubimyCzytac',
    hint: t('settings.metadata.providers.hints.lubimyczytac'),
    fields: [],
  },
  {
    key: 'aladin',
    label: 'Aladin',
    hint: t('settings.metadata.providers.hints.aladin'),
    fields: [{ key: 'ttbKey', label: t('settings.metadata.providers.fields.ttbKey'), type: 'password', placeholder: 'ttb...', alwaysEditable: true }],
    enableRequirement: {
      isConfigured: (c) => !!c.aladin.ttbKey.trim(),
      blockedMessage: t('settings.metadata.providers.blocked.aladin'),
    },
  },
])

const TESTABLE_PROVIDERS: MetadataProviderKey[] = [MetadataProviderKey.AMAZON, MetadataProviderKey.HARDCOVER, MetadataProviderKey.ALADIN]

function statusFor(key: string) {
  return props.statuses.find((s) => s.key === key)
}

function runtimeFor(key: string): ProviderThrottleRuntimeState | undefined {
  return props.runtimeByKey?.[key as MetadataProviderKey]
}

function throttleSecondsLeft(key: string): number | null {
  const state = runtimeFor(key)
  if (!state?.throttled || !state.throttledUntil) return null
  const remaining = Math.ceil((Date.parse(state.throttledUntil) - nowMs.value) / 1000)
  return remaining > 0 ? remaining : null
}

function isThrottled(key: string): boolean {
  return throttleSecondsLeft(key) !== null
}

function throttleMessage(key: string): string | null {
  const seconds = throttleSecondsLeft(key)
  if (seconds === null) return null
  return t('settings.metadata.providers.retryIn', { duration: formatDuration(seconds) })
}

function isTesting(key: string): boolean {
  return props.testingByKey?.[key as MetadataProviderKey] === true
}

function testResultFor(key: string): ProviderConnectionTestResult | null {
  return props.testResultsByKey?.[key as MetadataProviderKey] ?? null
}

function testResultClass(key: string): string {
  const status = testResultFor(key)?.status
  if (status === 'success') return 'text-emerald-600'
  if (status === 'warning') return 'text-amber-600'
  return 'text-destructive'
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

function enableBlockedMessage(row: RowDef): string | null {
  if (!draft.value || !row.enableRequirement) return null
  const req = row.enableRequirement
  if (!req.isConfigured(draft.value)) return req.blockedMessage
  if (req.requiresPassingTest && !hasPassingTestForCurrentInput(row.key as MetadataProviderKey)) {
    return req.missingTestMessage ?? t('settings.metadata.providers.runTestBeforeEnabling')
  }
  return null
}

function isConfiguredBadge(row: RowDef): boolean {
  const status = statusFor(row.key)
  if (!status) return false
  if (row.key !== 'hardcover') return status.configured
  if (draft.value?.hardcover.enabled) return true
  return hasPassingTestForCurrentInput(MetadataProviderKey.HARDCOVER)
}

type BadgeView = { label: string; variant: 'destructive' | 'outline'; class?: string }
function badgeFor(row: RowDef): BadgeView | null {
  if (!statusFor(row.key)) return null
  if (!isConfiguredBadge(row)) return { label: t('settings.metadata.providers.badge.setupRequired'), variant: 'destructive' }
  if (isThrottled(row.key)) {
    return { label: t('settings.metadata.providers.badge.throttled'), variant: 'outline', class: 'text-amber-600 border-amber-500/30 bg-amber-500/5' }
  }
  return { label: t('settings.metadata.providers.badge.ready'), variant: 'outline', class: 'text-emerald-600 border-emerald-500/30 bg-emerald-500/5' }
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

function save() {
  if (!draft.value) return
  emit('save', draft.value)
}

function testProvider(rowKey: keyof ProviderConfigurations) {
  if (!draft.value || !isTestable(rowKey)) return
  const patch = { [rowKey]: { ...draft.value[rowKey] } } as Partial<ProviderConfigurations>
  emit('test', rowKey, patch)
}

function canEditField(row: RowDef, field: FieldDef): boolean {
  if (!draft.value) return false
  return draft.value[row.key].enabled || field.alwaysEditable === true
}

function showHardcoverEnableHint(row: RowDef): boolean {
  if (!draft.value || row.key !== 'hardcover') return false
  if (draft.value.hardcover.enabled) return false
  if (!draft.value.hardcover.apiKey.trim()) return false
  return !hasPassingTestForCurrentInput(MetadataProviderKey.HARDCOVER)
}

function isToggleDisabled(row: RowDef): boolean {
  if (!draft.value) return true
  return !draft.value[row.key].enabled && enableBlockedMessage(row) !== null
}

function toggleProvider(row: RowDef) {
  if (!draft.value) return
  const provider = draft.value[row.key]
  const blocked = !provider.enabled ? enableBlockedMessage(row) : null
  if (blocked) {
    toast.error(blocked)
    return
  }
  provider.enabled = !provider.enabled
}

const draftReady = computed(() => draft.value !== null)
const visibleRows = computed(() => {
  if (!draft.value) return []
  return rows.value.filter((row) => Object.prototype.hasOwnProperty.call(draft.value, row.key))
})
</script>

<template>
  <form class="border border-border rounded-lg bg-card overflow-hidden shadow-xs" @submit.prevent="save">
    <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex items-center justify-between bg-muted/30">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.providers.availableSources') }}</span>
      </div>
      <button type="submit" class="settings-btn-primary h-8 px-3" :disabled="saving || !draftReady">
        <Loader2 v-if="saving" :size="14" class="animate-spin" />
        <Save v-else :size="14" />
        <span>{{ t('settings.metadata.providers.saveChanges') }}</span>
      </button>
    </div>

    <div v-if="draft" class="divide-y divide-border">
      <div
        v-for="row in visibleRows"
        :key="row.key"
        class="px-4 py-3.5 md:px-5 md:py-4 flex flex-col md:flex-row md:items-start gap-3 md:gap-4 bg-card transition-colors hover:bg-muted/30"
      >
        <div class="space-y-1 min-w-0 md:flex-1">
          <div class="flex items-center gap-3">
            <span class="settings-label">{{ row.label }}</span>
            <Badge
              v-if="badgeFor(row)"
              :variant="badgeFor(row)!.variant"
              class="h-4 px-1.5 text-[9px] font-bold uppercase tracking-wide"
              :class="badgeFor(row)!.class"
            >
              {{ badgeFor(row)!.label }}
            </Badge>
          </div>
          <p v-if="row.hint" class="settings-hint max-w-md text-[11px] leading-snug md:max-w-none">
            {{ row.hint }}
          </p>
          <p v-if="throttleMessage(row.key)" class="text-xs text-amber-600">
            {{ throttleMessage(row.key) }}
          </p>
        </div>

        <div class="flex flex-col items-stretch md:items-end gap-2 w-full md:w-auto md:min-w-[22rem]">
          <div v-if="row.fields.length" class="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center md:justify-end">
            <div v-for="field in row.fields" :key="field.key" class="min-w-0 md:flex md:flex-col md:items-end">
              <select
                v-if="field.type === 'select'"
                v-model="(draft[row.key] as unknown as Record<string, string>)[field.key]"
                :disabled="!canEditField(row, field)"
                class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 transition-all"
                :class="field.widthClass ?? 'md:min-w-[11rem]'"
              >
                <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
              <input
                v-else
                v-model="(draft[row.key] as unknown as Record<string, string>)[field.key]"
                :type="field.type === 'password' ? 'password' : field.type"
                :name="`metadata-${row.key}-${field.key}`"
                :placeholder="field.placeholder ?? field.label"
                :disabled="!canEditField(row, field)"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                :data-lpignore="field.type === 'password' ? 'true' : undefined"
                :data-1p-ignore="field.type === 'password' ? 'true' : undefined"
                :data-form-type="field.type === 'password' ? 'other' : undefined"
                class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-xs font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 transition-all md:w-72 lg:w-80"
              />
              <p v-if="field.helper" class="mt-0.5 max-w-72 text-[10px] leading-snug text-muted-foreground md:text-right">
                {{ field.helper }}
              </p>
            </div>
          </div>

          <div class="flex w-full flex-wrap items-center justify-between gap-2 md:justify-end">
            <button
              v-if="isTestable(row.key)"
              type="button"
              class="settings-btn-outline h-7 px-2.5 text-[11px]"
              :disabled="isTesting(row.key)"
              @click="testProvider(row.key)"
            >
              <Loader2 v-if="isTesting(row.key)" :size="11" class="animate-spin" />
              <span>{{ isTesting(row.key) ? t('settings.metadata.providers.testing') : t('settings.metadata.providers.test') }}</span>
            </button>
            <span v-else />
            <span class="text-[11px] text-muted-foreground md:hidden">{{ t('settings.metadata.providers.enabled') }}</span>
            <button
              type="button"
              role="switch"
              :aria-checked="draft[row.key].enabled"
              :aria-disabled="isToggleDisabled(row)"
              :disabled="isToggleDisabled(row)"
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              :class="draft[row.key].enabled ? 'bg-primary' : 'bg-muted border border-border'"
              @click="toggleProvider(row)"
            >
              <span
                class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform"
                :class="draft[row.key].enabled ? 'translate-x-4.5' : 'translate-x-0.5'"
              />
            </button>
          </div>

          <p v-if="testResultFor(row.key)" class="text-[11px] leading-snug md:text-right" :class="testResultClass(row.key)">
            {{ testResultFor(row.key)?.message }}
          </p>
          <p v-if="showHardcoverEnableHint(row)" class="text-[10px] text-muted-foreground md:text-right">
            {{ t('settings.metadata.providers.hardcoverEnableHint') }}
          </p>
        </div>
      </div>
    </div>

    <div v-else class="px-6 py-12 flex items-center justify-center">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" />
    </div>
  </form>
</template>
