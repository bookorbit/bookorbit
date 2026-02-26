<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Save } from 'lucide-vue-next'
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldPreferenceTable from './FieldPreferenceTable.vue'

const props = defineProps<{
  preferences: MetadataFetchPreferences | null
  statuses: ProviderStatus[]
  saving: boolean
}>()

const emit = defineEmits<{ save: [prefs: MetadataFetchPreferences] }>()

const draft = ref<MetadataFetchPreferences | null>(null)

watch(
  () => props.preferences,
  (p) => {
    if (p) draft.value = JSON.parse(JSON.stringify(p))
  },
  { immediate: true },
)

function onFieldChange(field: MetadataField, pref: FieldPreference) {
  if (!draft.value) return
  draft.value = { fields: { ...draft.value.fields, [field]: pref } }
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
        <p class="text-sm font-semibold text-foreground">Global Defaults</p>
        <p class="text-xs text-muted-foreground mt-0.5">Default rules applied to every library. Override per-library below.</p>
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

    <div v-if="draft">
      <FieldPreferenceTable :preferences="draft" :statuses="statuses" @change="onFieldChange" />
    </div>
    <div v-else class="px-5 py-6 text-sm text-muted-foreground">Loading...</div>
  </div>
</template>
