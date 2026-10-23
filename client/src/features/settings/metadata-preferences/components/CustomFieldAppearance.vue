<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CustomMetadataFieldType, CustomMetadataPrimitiveValue, Library } from '@bookorbit/types'
import CustomMetadataValueInput from '@/features/book/components/CustomMetadataValueInput.vue'
import { formatList } from '@/i18n/formatters'
import { filterOperatorsFor, typeExampleKey } from '../lib/custom-field-types'

/**
 * Everywhere a field shows up once it exists. The Edit Metadata cell is the form's own component,
 * so what is previewed here is what a book gets.
 */
const props = defineProps<{
  type: CustomMetadataFieldType
  label: string
  fieldKey: string
  libraryIds: number[]
  libraries: Library[]
}>()

const { t } = useI18n()

const previewValue = ref<CustomMetadataPrimitiveValue>(null)
watch(
  () => props.type,
  () => (previewValue.value = null),
)

const shownLabel = computed(() => props.label.trim() || t('settings.metadata.customFields.untitledField'))
const example = computed(() => t(typeExampleKey(props.type)))
const exampleText = computed(() => (props.type === 'boolean' ? t('common.yes') : example.value))
const operators = computed(() => filterOperatorsFor(props.type).map((operator) => t(`book.filter.operators.${operator}`)))
const writers = computed(() =>
  props.libraries.filter(
    (library) => props.libraryIds.includes(library.id) && library.fileWriteEnabled && (library.fileWriteEpubEnabled || library.fileWriteFb2Enabled),
  ),
)
const writerNames = computed(() => formatList(writers.value.map((library) => library.name)))
</script>

<template>
  <section class="space-y-2">
    <h3 class="settings-label">{{ t('settings.metadata.customFields.sheet.appears.title') }}</h3>
    <dl class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      <div class="grid grid-cols-1 gap-1.5 px-3.5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
        <dt class="pt-0.5 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.appears.editMetadata') }}</dt>
        <dd class="max-w-[17rem]"><CustomMetadataValueInput v-model="previewValue" :label="shownLabel" :type="type" /></dd>
      </div>
      <div class="grid grid-cols-1 gap-1.5 px-3.5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
        <dt class="pt-0.5 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.appears.details') }}</dt>
        <dd class="min-w-0">
          <p class="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{{ shownLabel }}</p>
          <p class="mt-1 text-sm break-words" :class="type === 'url' ? 'text-primary' : 'text-foreground'">{{ exampleText }}</p>
        </dd>
      </div>
      <div class="grid grid-cols-1 gap-1.5 px-3.5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
        <dt class="pt-0.5 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.appears.filters') }}</dt>
        <dd class="flex flex-wrap gap-1">
          <span
            v-for="operator in operators"
            :key="operator"
            class="inline-flex h-5 items-center rounded-[5px] bg-foreground/6 px-1.5 text-[11.5px] whitespace-nowrap text-foreground"
          >
            {{ operator }}
          </span>
        </dd>
      </div>
      <div class="grid grid-cols-1 gap-1.5 px-3.5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
        <dt class="pt-0.5 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.appears.table') }}</dt>
        <dd class="text-sm text-foreground">{{ t('settings.metadata.customFields.sheet.appears.tableBody') }}</dd>
      </div>
      <div class="grid grid-cols-1 gap-1.5 px-3.5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
        <dt class="pt-0.5 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.appears.files') }}</dt>
        <dd class="min-w-0 space-y-1.5">
          <code
            class="inline-block max-w-full rounded-[5px] border border-foreground/9 bg-foreground/6 px-1.5 py-px font-mono text-xs break-all text-foreground"
            >bookorbit:custom:{{ fieldKey }}</code
          >
          <p class="text-xs text-muted-foreground">
            {{
              writers.length > 0
                ? t('settings.metadata.customFields.sheet.appears.filesWritten', { libraries: writerNames })
                : t('settings.metadata.customFields.sheet.appears.filesNotWritten')
            }}
          </p>
        </dd>
      </div>
      <div class="grid grid-cols-1 gap-1.5 px-3.5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
        <dt class="pt-0.5 text-xs text-muted-foreground">{{ t('settings.metadata.customFields.sheet.appears.exports') }}</dt>
        <dd class="min-w-0">
          <code
            class="inline-block max-w-full rounded-[5px] border border-foreground/9 bg-foreground/6 px-1.5 py-px font-mono text-xs break-all text-foreground"
            >custom.{{ fieldKey }}</code
          >
        </dd>
      </div>
    </dl>
  </section>
</template>
