<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Plus, Tag } from '@lucide/vue'
import type { CustomMetadataFieldType } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { CUSTOM_FIELD_TYPE_META } from '../lib/custom-field-types'

const emit = defineEmits<{ create: []; start: [starter: { label: string; type: CustomMetadataFieldType }] }>()

const { t } = useI18n()

const EXAMPLES: Array<{ key: string; type: CustomMetadataFieldType }> = [
  { key: 'shelfNumber', type: 'number' },
  { key: 'acquiredOn', type: 'date' },
  { key: 'signedCopy', type: 'boolean' },
  { key: 'loanedTo', type: 'text' },
]

function handleCreate() {
  emit('create')
}

function startFrom(example: { key: string; type: CustomMetadataFieldType }) {
  emit('start', { label: t(`settings.metadata.customFields.empty.${example.key}`), type: example.type })
}
</script>

<template>
  <div class="rounded-lg border border-border bg-card px-6 py-12 shadow-xs">
    <div class="mx-auto flex max-w-md flex-col items-center text-center">
      <span class="grid size-11 place-items-center rounded-[10px] border border-primary/30 bg-primary/12 text-primary" aria-hidden="true">
        <Tag :size="20" />
      </span>
      <h2 class="mt-4 text-[15px] font-semibold text-balance text-foreground">{{ t('settings.metadata.customFields.emptyTitle') }}</h2>
      <p class="mt-1.5 text-sm text-muted-foreground">{{ t('settings.metadata.customFields.empty.body') }}</p>
      <Button size="sm" type="button" class="mt-5" @click="handleCreate">
        <Plus :size="14" aria-hidden="true" />
        {{ t('settings.metadata.customFields.newFieldAction') }}
      </Button>
      <div class="mt-6 w-full border-t border-border pt-4">
        <p class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {{ t('settings.metadata.customFields.empty.examples') }}
        </p>
        <div class="mt-3 flex flex-wrap justify-center gap-2">
          <Button v-for="example in EXAMPLES" :key="example.key" variant="outline" size="sm" type="button" @click="startFrom(example)">
            <component :is="CUSTOM_FIELD_TYPE_META[example.type].icon" :size="14" class="text-muted-foreground" aria-hidden="true" />
            {{ t(`settings.metadata.customFields.empty.${example.key}`) }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
