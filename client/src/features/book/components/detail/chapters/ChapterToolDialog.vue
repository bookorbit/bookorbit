<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import {
  InvalidPatternError,
  mergeShortChapters,
  renumberTitles,
  replaceInTitles,
  shiftChapters,
  type DraftChapter,
} from '@/features/book/lib/chapter-edit'

export type ChapterTool = 'shift' | 'renumber' | 'replace' | 'mergeShort'
type Scope = 'all' | 'selected' | 'fromActive'

const props = defineProps<{
  open: boolean
  tool: ChapterTool
  rows: DraftChapter[]
  selected: Set<string>
  activeIndex: number
  totalDurationMs: number | null
}>()

const emit = defineEmits<{ apply: [rows: DraftChapter[]]; cancel: [] }>()

const { t } = useI18n()

const TITLE_KEYS: Record<ChapterTool, { title: string; description: string }> = {
  shift: { title: 'book.detail.chapters.tools.shift.title', description: 'book.detail.chapters.tools.shift.description' },
  renumber: { title: 'book.detail.chapters.tools.renumber.title', description: 'book.detail.chapters.tools.renumber.description' },
  replace: { title: 'book.detail.chapters.tools.replace.title', description: 'book.detail.chapters.tools.replace.description' },
  mergeShort: { title: 'book.detail.chapters.tools.mergeShort.title', description: 'book.detail.chapters.tools.mergeShort.description' },
}

const scope = ref<Scope>('all')
const shiftSeconds = ref('0')
const pattern = ref('')
const startNumber = ref(1)
const padding = ref(0)
const find = ref('')
const replacement = ref('')
const useRegex = ref(false)
const caseSensitive = ref(false)
const minSeconds = ref('2')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    scope.value = props.selected.size > 0 ? 'selected' : 'all'
    shiftSeconds.value = '0'
    pattern.value = t('book.detail.chapters.tools.renumber.defaultPattern')
    startNumber.value = 1
    padding.value = 0
    find.value = ''
    replacement.value = ''
    useRegex.value = false
    caseSensitive.value = false
    minSeconds.value = '2'
  },
)

const scopeOptions = computed(() => {
  const options: { value: Scope; label: string; disabled: boolean }[] = [
    { value: 'all', label: t('book.detail.chapters.tools.scope.all', { count: props.rows.length }), disabled: false },
    {
      value: 'selected',
      label: t('book.detail.chapters.tools.scope.selected', { count: props.selected.size }),
      disabled: props.selected.size === 0,
    },
  ]
  if (props.tool === 'shift') {
    const from = Math.max(props.activeIndex, 0)
    options.push({
      value: 'fromActive',
      label: t('book.detail.chapters.tools.scope.fromActive', { index: formatNumber(from + 1) }),
      disabled: false,
    })
  }
  return options
})

const keys = computed(() => {
  if (scope.value === 'selected') return new Set(props.selected)
  if (scope.value === 'fromActive') return new Set(props.rows.slice(Math.max(props.activeIndex, 0)).map((row) => row.key))
  return new Set(props.rows.map((row) => row.key))
})

function parseSeconds(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/** What the tool would produce, plus how many rows it touches, so Apply can say so up front. */
const outcome = computed<{ rows: DraftChapter[]; changed: number } | { error: string }>(() => {
  if (props.tool === 'shift') {
    const seconds = parseSeconds(shiftSeconds.value)
    if (seconds === null) return { error: t('book.detail.chapters.tools.shift.invalid') }
    const rows = shiftChapters(props.rows, Math.round(seconds * 1000), keys.value, props.totalDurationMs)
    return { rows, changed: rows.filter((row, index) => row.startMs !== props.rows[index]!.startMs).length }
  }
  if (props.tool === 'renumber') {
    if (
      !Number.isSafeInteger(startNumber.value) ||
      startNumber.value < 0 ||
      !Number.isInteger(padding.value) ||
      padding.value < 0 ||
      padding.value > 4 ||
      startNumber.value + keys.value.size > Number.MAX_SAFE_INTEGER
    ) {
      return { error: t('book.detail.chapters.tools.renumber.invalid') }
    }
    const rows = renumberTitles(props.rows, keys.value, pattern.value.trim(), startNumber.value, padding.value)
    return { rows, changed: rows.filter((row, index) => row.title !== props.rows[index]!.title).length }
  }
  if (props.tool === 'replace') {
    try {
      const result = replaceInTitles(props.rows, keys.value, find.value, replacement.value, {
        regex: useRegex.value,
        caseSensitive: caseSensitive.value,
      })
      return { rows: result.draft, changed: result.changed }
    } catch (reason) {
      if (reason instanceof InvalidPatternError) return { error: t('book.detail.chapters.tools.replace.invalidPattern') }
      throw reason
    }
  }
  const seconds = parseSeconds(minSeconds.value)
  if (seconds === null || seconds <= 0) return { error: t('book.detail.chapters.tools.mergeShort.invalid') }
  const result = mergeShortChapters(props.rows, Math.round(seconds * 1000), props.totalDurationMs)
  return { rows: result.draft, changed: result.merged }
})

const summary = computed(() => {
  const value = outcome.value
  if ('error' in value) return value.error
  return t('book.detail.chapters.tools.changes', { count: value.changed })
})

const canApply = computed(() => !('error' in outcome.value) && outcome.value.changed > 0)

function handleOpenChange(open: boolean) {
  if (!open) emit('cancel')
}

function handleCancel() {
  emit('cancel')
}

function handleApply() {
  const value = outcome.value
  if ('error' in value || value.changed === 0) return
  emit('apply', value.rows)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t(TITLE_KEYS[tool].title) }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t(TITLE_KEYS[tool].description) }}</DialogDescription>

        <form class="mt-5 flex flex-col gap-4" @submit.prevent="handleApply">
          <template v-if="tool === 'shift'">
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('book.detail.chapters.tools.shift.amount') }}
              <input
                v-model="shiftSeconds"
                inputmode="decimal"
                class="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span class="text-xs font-normal text-muted-foreground">{{ t('book.detail.chapters.tools.shift.hint') }}</span>
            </label>
          </template>

          <template v-else-if="tool === 'renumber'">
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('book.detail.chapters.tools.renumber.pattern') }}
              <input
                v-model="pattern"
                class="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span class="text-xs font-normal text-muted-foreground">{{ t('book.detail.chapters.tools.renumber.hint') }}</span>
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1.5 text-sm font-medium">
                {{ t('book.detail.chapters.tools.renumber.start') }}
                <input
                  v-model.number="startNumber"
                  type="number"
                  min="0"
                  class="h-9 rounded-md border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label class="flex flex-col gap-1.5 text-sm font-medium">
                {{ t('book.detail.chapters.tools.renumber.padding') }}
                <input
                  v-model.number="padding"
                  type="number"
                  min="0"
                  max="4"
                  class="h-9 rounded-md border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
          </template>

          <template v-else-if="tool === 'replace'">
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('book.detail.chapters.tools.replace.find') }}
              <input
                v-model="find"
                class="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('book.detail.chapters.tools.replace.with') }}
              <input
                v-model="replacement"
                class="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <div class="flex flex-wrap gap-4 text-sm">
              <label class="flex items-center gap-2"
                ><input v-model="useRegex" type="checkbox" class="size-3.5 accent-[var(--primary)]" />{{
                  t('book.detail.chapters.tools.replace.regex')
                }}</label
              >
              <label class="flex items-center gap-2"
                ><input v-model="caseSensitive" type="checkbox" class="size-3.5 accent-[var(--primary)]" />{{
                  t('book.detail.chapters.tools.replace.caseSensitive')
                }}</label
              >
            </div>
          </template>

          <template v-else>
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('book.detail.chapters.tools.mergeShort.threshold') }}
              <input
                v-model="minSeconds"
                inputmode="decimal"
                class="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </template>

          <fieldset v-if="tool !== 'mergeShort'" class="flex flex-col gap-1.5">
            <legend class="mb-1.5 text-sm font-medium">{{ t('book.detail.chapters.tools.scope.label') }}</legend>
            <label
              v-for="option in scopeOptions"
              :key="option.value"
              class="flex items-center gap-2 text-sm"
              :class="option.disabled ? 'text-muted-foreground' : ''"
            >
              <input v-model="scope" type="radio" :value="option.value" :disabled="option.disabled" class="size-3.5 accent-[var(--primary)]" />
              {{ option.label }}
            </label>
          </fieldset>

          <p class="text-sm" :class="'error' in outcome ? 'text-destructive' : 'text-muted-foreground'" role="status">{{ summary }}</p>

          <div class="mt-1 flex justify-end gap-2">
            <Button variant="outline" type="button" @click="handleCancel">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="!canApply">{{ t('book.detail.chapters.tools.apply') }}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
