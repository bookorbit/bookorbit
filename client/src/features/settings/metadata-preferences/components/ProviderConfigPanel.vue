<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Save } from 'lucide-vue-next'
import type { ProviderConfigurations, ProviderStatus } from '@projectx/types'

const props = defineProps<{
  config: ProviderConfigurations | null
  statuses: ProviderStatus[]
  saving: boolean
}>()

const emit = defineEmits<{ save: [patch: Partial<ProviderConfigurations>] }>()

const draft = ref<ProviderConfigurations | null>(null)

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

type FieldDef =
  | { key: string; label: string; type: 'text' | 'password' | 'select'; hint?: string; options?: string[] }

const rows: { key: keyof ProviderConfigurations; label: string; fields: FieldDef[] }[] = [
  {
    key: 'google',
    label: 'Google Books',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        hint: 'Recommended for higher rate limits. Works without one.',
      },
    ],
  },
  {
    key: 'amazon',
    label: 'Amazon',
    fields: [
      { key: 'domain', label: 'Region', type: 'select', options: AMAZON_DOMAINS },
      {
        key: 'cookie',
        label: 'Cookie',
        type: 'password',
        hint: 'Optional but highly recommended - provides richer metadata and avoids rate limiting.',
      },
    ],
  },
  { key: 'goodreads', label: 'Goodreads', fields: [] },
  {
    key: 'hardcover',
    label: 'Hardcover',
    fields: [{ key: 'apiKey', label: 'API key', type: 'password' }],
  },
  { key: 'openLibrary', label: 'Open Library', fields: [] },
]

function statusFor(key: string) {
  return props.statuses.find((s) => s.key === key)
}

function save() {
  if (!draft.value) return
  emit('save', draft.value)
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card overflow-hidden">
    <div class="px-5 py-4 border-b border-border flex items-center justify-between">
      <div>
        <p class="text-sm font-semibold text-foreground">Metadata Providers</p>
        <p class="text-xs text-muted-foreground mt-0.5">Enable providers and configure API keys or cookies where needed.</p>
      </div>
      <button
        class="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="saving || !draft"
        @click="save"
      >
        <Loader2 v-if="saving" :size="13" class="animate-spin" />
        <Save v-else :size="13" />
        Save
      </button>
    </div>

    <div v-if="draft" class="divide-y divide-border/60">
      <div v-for="row in rows" :key="row.key" class="px-5 py-3.5 flex flex-col sm:flex-row sm:items-start gap-3">
        <div class="flex items-start gap-3 sm:w-44 shrink-0 pt-0.5">
          <input v-model="draft[row.key].enabled" type="checkbox" class="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer mt-0.5" />
          <div>
            <p class="text-sm font-medium text-foreground">{{ row.label }}</p>
            <template v-if="statusFor(row.key)">
              <p v-if="!statusFor(row.key)?.configured" class="text-[10px] text-amber-600">API key required</p>
              <p v-else-if="statusFor(row.key)?.hint" class="text-[10px] text-amber-500">{{ statusFor(row.key)?.hint }}</p>
              <p v-else class="text-[10px] text-emerald-600">Configured</p>
            </template>
          </div>
        </div>

        <div v-if="row.fields.length" class="flex flex-col gap-2 flex-1">
          <div v-for="field in row.fields" :key="field.key">
            <select
              v-if="field.type === 'select'"
              v-model="(draft[row.key] as Record<string, string>)[field.key]"
              :disabled="!draft[row.key].enabled"
              class="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 cursor-pointer"
            >
              <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <template v-else>
              <input
                v-model="(draft[row.key] as Record<string, string>)[field.key]"
                :type="field.type"
                :placeholder="field.label"
                :disabled="!draft[row.key].enabled"
                class="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
              <p v-if="field.hint" class="text-[10px] text-muted-foreground mt-0.5">{{ field.hint }}</p>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="px-5 py-6 text-sm text-muted-foreground">Loading...</div>
  </div>
</template>
