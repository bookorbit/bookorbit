<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Wand } from '@lucide/vue'
import type { OrganizationMode } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import PatternText from './PatternText.vue'
import { metadataWithout, previewUploadPath } from '../lib/pattern-preview'
import { PATTERN_EXAMPLES } from '../lib/pattern-examples'
import type { NamingTarget } from '../lib/naming-rules'

const props = defineProps<{
  open: boolean
  target: NamingTarget
  organizationMode: OrganizationMode | null
  sanitize: boolean
}>()

const emit = defineEmits<{ 'update:open': [value: boolean]; apply: [pattern: string] }>()

const { t } = useI18n()

const mode = computed<OrganizationMode>(() => props.organizationMode ?? 'book_per_file')
/** Every example is an upload path, so the download rule gets them as reference only. */
const canApply = computed(() => props.target === 'upload')

const rows = computed(() =>
  PATTERN_EXAMPLES.map((example) => {
    const pattern = example.patterns[mode.value]
    // Folder mode still shows the file-mode form so the idiom itself stays readable.
    const shown = pattern ?? example.patterns.book_per_file ?? ''
    return {
      id: example.id,
      label: t(example.labelKey),
      pattern: shown,
      applyPattern: pattern,
      cases: example.cases.map((exampleCase) => ({
        label: t(exampleCase.labelKey),
        path: previewUploadPath(shown, { sanitizeForCrossPlatform: props.sanitize }, metadataWithout(...exampleCase.omit)),
      })),
    }
  }),
)

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

function applyExample(pattern: string) {
  emit('apply', pattern)
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" class="w-full gap-0 sm:max-w-2xl">
      <SheetHeader class="border-b border-border pr-10">
        <SheetTitle>{{ t('settings.reader.fileNaming.examples') }}</SheetTitle>
        <SheetDescription>{{ t('settings.reader.fileNaming.examplesDescription') }}</SheetDescription>
      </SheetHeader>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <p v-if="!canApply" class="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
          {{ t('settings.reader.fileNaming.examplesUploadOnly') }}
        </p>

        <ul class="list-none divide-y divide-border rounded-md border border-border p-0">
          <li v-for="row in rows" :key="row.id" class="space-y-2 px-3 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="settings-label">{{ row.label }}</p>
                <p class="mt-1 break-words font-mono text-xs leading-relaxed">
                  <PatternText :pattern="row.pattern" />
                </p>
              </div>
              <Button
                v-if="canApply && row.applyPattern"
                variant="outline"
                size="sm"
                type="button"
                class="shrink-0"
                :aria-label="t('settings.reader.fileNaming.examplesApplyAria', { label: row.label })"
                @click="applyExample(row.applyPattern)"
              >
                <Wand :size="12" aria-hidden="true" />
                {{ t('settings.reader.fileNaming.examplesApply') }}
              </Button>
            </div>

            <p v-if="canApply && !row.applyPattern" class="text-[11px] text-muted-foreground">
              {{ t('settings.reader.fileNaming.examplesFileModeOnly') }}
            </p>

            <dl class="space-y-1">
              <div v-for="item in row.cases" :key="item.label" class="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                <dt class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:w-24">{{ item.label }}</dt>
                <dd class="min-w-0 break-all font-mono text-xs text-primary">{{ item.path }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </div>
    </SheetContent>
  </Sheet>
</template>
