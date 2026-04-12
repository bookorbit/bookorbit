<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Loader2, Save } from 'lucide-vue-next'
import type { MetadataProviderKey, ProviderConfigurations, ProviderStatus, ProviderThrottleRuntimeState } from '@projectx/types'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  config: ProviderConfigurations | null
  statuses: ProviderStatus[]
  runtimeByKey?: Partial<Record<MetadataProviderKey, ProviderThrottleRuntimeState>>
  saving: boolean
}>()

const emit = defineEmits<{ save: [patch: Partial<ProviderConfigurations>] }>()

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
    if (c) draft.value = JSON.parse(JSON.stringify(c))
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

type FieldDef = { key: string; label: string; type: 'text' | 'password' | 'select'; options?: string[] }

const rows: { key: keyof ProviderConfigurations; label: string; hint?: string; fields: FieldDef[] }[] = [
  {
    key: 'google',
    label: 'Google Books',
    hint: "Broad coverage from Google's book index. Add an API key to avoid rate limits.",
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password' }],
  },
  {
    key: 'amazon',
    label: 'Amazon',
    hint: 'Pulls from Amazon product pages. A session cookie is highly recommended.',
    fields: [
      { key: 'domain', label: 'Region', type: 'select', options: AMAZON_DOMAINS },
      { key: 'cookie', label: 'Cookie', type: 'password' },
    ],
  },
  { key: 'goodreads', label: 'Goodreads', hint: 'The largest reading community on the web. No setup required.', fields: [] },
  {
    key: 'hardcover',
    label: 'Hardcover',
    hint: 'A modern alternative to Goodreads. Free API key required from hardcover.app.',
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password' }],
  },
  { key: 'openLibrary', label: 'Open Library', hint: "The Internet Archive's free book catalog. No setup required.", fields: [] },
  {
    key: 'itunes',
    label: 'iTunes',
    hint: "Apple's digital book catalog. Choose whether to fetch high or standard resolution covers.",
    fields: [{ key: 'coverResolution', label: 'Cover Resolution', type: 'select', options: ['high', 'standard'] }],
  },
  {
    key: 'audible',
    label: 'Audible',
    hint: 'Pulls audiobook metadata from Audible. No additional setup is required.',
    fields: [{ key: 'domain', label: 'Region', type: 'select', options: AUDIBLE_DOMAINS }],
  },
  { key: 'audnexus', label: 'AudNexus', hint: 'Community-driven audiobook metadata. No setup required.', fields: [] },
  {
    key: 'comicvine',
    label: 'ComicVine',
    hint: 'Comic book metadata from ComicVine. A free API key is required from comicvine.gamespot.com.',
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password' }],
  },
]

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
  return `Retry in ${formatDuration(seconds)}`
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

function onSecretFieldFocus(event: FocusEvent) {
  const input = event.target as HTMLInputElement | null
  if (input?.readOnly) input.readOnly = false
}
</script>

<template>
  <div class="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
    <!-- Card Header -->
    <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex items-center justify-between bg-muted/30">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">Available Sources</span>
      </div>
      <button class="settings-btn-primary h-8 px-3" :disabled="saving || !draft" @click="save">
        <Loader2 v-if="saving" :size="14" class="animate-spin" />
        <Save v-else :size="14" />
        <span>Save Changes</span>
      </button>
    </div>

    <div v-if="draft" class="divide-y divide-border">
      <div
        v-for="row in rows"
        :key="row.key"
        class="px-4 py-3.5 md:px-5 md:py-4 flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-6 bg-card transition-colors hover:bg-muted/30"
      >
        <!-- Left: Provider Info -->
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-3">
            <span class="settings-label">{{ row.label }}</span>
            <template v-if="statusFor(row.key)">
              <Badge v-if="!statusFor(row.key)?.configured" variant="destructive" class="h-4 px-1.5 text-[9px] font-bold uppercase tracking-wide">
                Setup Required
              </Badge>
              <Badge
                v-else-if="isThrottled(row.key)"
                variant="outline"
                class="h-4 px-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 border-amber-500/30 bg-amber-500/5"
              >
                Throttled
              </Badge>
              <Badge
                v-else
                variant="outline"
                class="h-4 px-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600 border-emerald-500/30 bg-emerald-500/5"
              >
                Ready
              </Badge>
            </template>
          </div>
          <p v-if="row.hint" class="settings-hint max-w-sm">
            {{ row.hint }}
          </p>
          <p v-if="throttleMessage(row.key)" class="text-xs text-amber-600">
            {{ throttleMessage(row.key) }}
          </p>
        </div>

        <!-- Right: Config & Toggle -->
        <div class="flex flex-col items-start gap-3 w-full md:ml-auto md:w-auto md:min-w-[18rem]">
          <!-- Fields -->
          <div v-if="row.fields.length" class="flex flex-wrap items-center gap-2 w-full md:justify-end">
            <div v-for="field in row.fields" :key="field.key" class="relative w-full sm:w-auto">
              <select
                v-if="field.type === 'select'"
                v-model="(draft[row.key] as unknown as Record<string, string>)[field.key]"
                :disabled="!draft[row.key].enabled"
                class="h-9 w-full sm:w-auto rounded-md border border-input bg-background px-3 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 transition-all"
              >
                <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
              <input
                v-else
                v-model="(draft[row.key] as unknown as Record<string, string>)[field.key]"
                :type="field.type === 'password' ? 'text' : field.type"
                :name="`metadata-${row.key}-${field.key}`"
                :placeholder="field.label"
                :disabled="!draft[row.key].enabled"
                :readonly="field.type === 'password'"
                :autocomplete="field.type === 'password' ? 'off' : 'off'"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                :data-lpignore="field.type === 'password' ? 'true' : undefined"
                :data-1p-ignore="field.type === 'password' ? 'true' : undefined"
                :data-form-type="field.type === 'password' ? 'other' : undefined"
                :style="field.type === 'password' ? '--webkit-text-security: disc' : undefined"
                class="h-9 w-full sm:w-64 lg:w-80 rounded-md border border-input bg-background px-3 text-xs font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 transition-all"
                @focus="field.type === 'password' ? onSecretFieldFocus($event) : undefined"
              />
            </div>
          </div>

          <!-- Switch -->
          <div
            class="flex items-center justify-between w-full md:justify-end gap-3 rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 md:border-none md:bg-transparent md:px-0 md:py-0"
          >
            <span class="text-xs text-muted-foreground md:hidden">Enabled</span>
            <button
              type="button"
              role="switch"
              :aria-checked="draft[row.key].enabled"
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none"
              :class="draft[row.key].enabled ? 'bg-primary' : 'bg-muted border border-border'"
              @click="draft[row.key].enabled = !draft[row.key].enabled"
            >
              <span
                class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
                :class="draft[row.key].enabled ? 'translate-x-4.5' : 'translate-x-0.5'"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="px-6 py-12 flex items-center justify-center">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" />
    </div>
  </div>
</template>
