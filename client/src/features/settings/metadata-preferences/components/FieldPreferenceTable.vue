<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@bookorbit/types'
import FieldGroupSection from './FieldGroupSection.vue'
import ProviderReservoir from './ProviderReservoir.vue'
import { Info } from '@lucide/vue'

const { t } = useI18n()

defineProps<{
  preferences: MetadataFetchPreferences
  statuses: ProviderStatus[]
  overriddenFields?: Set<MetadataField>
  saving?: boolean
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
}>()

const GROUPS: { id: string; label: string; fields: MetadataField[] }[] = [
  { id: 'core', label: 'Core', fields: ['title', 'subtitle', 'description', 'cover'] },
  { id: 'contributors', label: 'Contributors', fields: ['authors'] },
  { id: 'publication', label: 'Publication', fields: ['publisher', 'publishedYear', 'language', 'pageCount', 'communityRating'] },
  { id: 'series', label: 'Series', fields: ['seriesName', 'seriesIndex'] },
  { id: 'classification', label: 'Classification', fields: ['genres'] },
  { id: 'audiobook', label: 'Audiobook', fields: ['narrators', 'duration', 'abridged'] },
]

const groups = computed(() => GROUPS.map((group) => ({ ...group, label: t(`settings.metadata.fieldRules.groups.${group.id}`) })))

const isMobile = useMediaQuery('(max-width: 767px)')
</script>

<template>
  <div class="space-y-0">
    <!-- Reservoir with context -->
    <div class="px-5 py-4 bg-muted/30 border-b border-border flex flex-col gap-3">
      <div class="flex items-center gap-2.5">
        <Info :size="14" class="text-primary shrink-0" />
        <p class="text-[11px] font-medium text-muted-foreground uppercase tracking-widest leading-none">
          {{ t('settings.metadata.fieldRules.dragProvidersHint') }}
        </p>
      </div>
      <div class="flex items-center">
        <ProviderReservoir :statuses="statuses" />
      </div>
    </div>

    <!-- Table Header (desktop) -->
    <div class="hidden md:flex items-center gap-4 px-5 py-3 bg-muted/10 border-b border-border/60">
      <div class="w-48 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {{ t('settings.metadata.fieldRules.table.field') }}
      </div>
      <div class="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {{ t('settings.metadata.fieldRules.table.activeProviders') }}
      </div>
      <div class="w-44 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {{ t('settings.metadata.fieldRules.table.mergeStrategy') }}
      </div>
      <div
        v-if="overriddenFields !== undefined"
        class="w-16 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center"
      >
        {{ t('settings.metadata.fieldRules.table.status') }}
      </div>
    </div>

    <!-- Content -->
    <div class="divide-y divide-border/60">
      <FieldGroupSection
        v-for="group in groups"
        :key="group.id"
        :label="group.label"
        :fields="group.fields"
        :default-open="!isMobile"
        :preferences="preferences.fields"
        :statuses="statuses"
        :overridden-fields="overriddenFields"
        :saving="saving"
        @change="(f, p) => emit('change', f, p)"
        @revert="(f) => emit('revert', f)"
      />
    </div>
  </div>
</template>
