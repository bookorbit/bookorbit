<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lock } from '@lucide/vue'
import type { BookMergeFieldPreview, BookMergeFieldValue } from '@bookorbit/types'
import { formatLanguageName, formatList, formatNumber } from '@/i18n/formatters'
import { isBlankMergeValue } from '@/features/book/lib/book-merge'

const props = defineProps<{
  field: BookMergeFieldPreview
  chosenBookId: number
  keeperId: number
  /** Short, distinguishable names of the books, keyed by id. */
  bookLabels: Map<number, string>
}>()

const emit = defineEmits<{ choose: [bookId: number] }>()

const { t } = useI18n()
const groupName = `merge-field-${useId()}`
const hintId = `${groupName}-hint`

interface FieldOption {
  key: string
  bookId: number
  display: string
  sources: string
}

const label = computed(() => t(`book.merge.fields.${props.field.field}`))

function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? ''
}

function displayValue(value: BookMergeFieldValue): string {
  if (value === null) return ''
  if (Array.isArray(value)) return formatList(value.map((entry) => entry.trim()).filter((entry) => entry.length > 0))
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
  if (typeof value === 'number') return props.field.field === 'publishedYear' ? String(value) : formatNumber(value)
  if (props.field.field === 'language') return formatLanguageName(value)
  if (props.field.field === 'description') return plainText(value)
  return value
}

function sourceName(bookId: number): string {
  return bookId === props.keeperId ? t('book.merge.review.fromKept') : t('book.merge.review.from', { title: props.bookLabels.get(bookId) ?? '' })
}

/** One option per distinct value; books holding the same value share it. */
const options = computed<FieldOption[]>(() => {
  const byKey = new Map<string, { bookId: number; display: string; bookIds: number[] }>()
  for (const candidate of props.field.candidates) {
    if (isBlankMergeValue(candidate.value)) continue
    const key = JSON.stringify(candidate.value)
    const existing = byKey.get(key)
    if (existing) existing.bookIds.push(candidate.bookId)
    else byKey.set(key, { bookId: candidate.bookId, display: displayValue(candidate.value), bookIds: [candidate.bookId] })
  }
  return [...byKey.entries()].map(([key, entry]) => ({
    key,
    bookId: entry.bookId,
    display: entry.display,
    sources: formatList(entry.bookIds.map(sourceName)),
  }))
})

const chosenKey = computed(() => {
  const candidate = props.field.candidates.find((entry) => entry.bookId === props.chosenBookId)
  return candidate && !isBlankMergeValue(candidate.value) ? JSON.stringify(candidate.value) : null
})

const chosenOption = computed(() => options.value.find((option) => option.key === chosenKey.value) ?? options.value[0] ?? null)

/** The kept book had nothing here, so the merge fills it from another book. */
const added = computed(() => {
  const keeperValue = props.field.candidates.find((entry) => entry.bookId === props.keeperId)?.value ?? null
  return isBlankMergeValue(keeperValue) && chosenKey.value !== null
})

function choose(bookId: number): void {
  emit('choose', bookId)
}
</script>

<template>
  <fieldset v-if="options.length > 1" class="min-w-0 space-y-1.5" :aria-describedby="field.lockedOnTarget ? hintId : undefined">
    <legend class="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
      <span>{{ label }}</span>
      <span v-if="field.lockedOnTarget" class="inline-flex items-center gap-1 text-foreground">
        <Lock :size="12" aria-hidden="true" />
        {{ t('book.merge.review.locked') }}
      </span>
      <span v-if="added" class="rounded-full bg-primary/10 px-1.5 py-px text-[0.68rem] font-medium text-primary">{{
        t('book.merge.review.added')
      }}</span>
    </legend>
    <p v-if="field.lockedOnTarget" :id="hintId" class="text-xs text-muted-foreground">{{ t('book.merge.review.lockedHint') }}</p>
    <label
      v-for="option in options"
      :key="option.key"
      class="flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
      :class="option.key === chosenKey ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'"
    >
      <input
        type="radio"
        class="mt-0.5 shrink-0 accent-primary focus-visible:outline-none"
        :name="groupName"
        :value="option.bookId"
        :checked="option.key === chosenKey"
        @change="choose(option.bookId)"
      />
      <span class="min-w-0 flex-1">
        <span class="block text-sm break-words text-foreground" :class="field.field === 'description' ? 'line-clamp-3' : undefined">{{
          option.display
        }}</span>
        <span class="block text-xs text-muted-foreground">{{ option.sources }}</span>
      </span>
    </label>
  </fieldset>

  <div v-else-if="chosenOption" class="min-w-0 space-y-1">
    <p class="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
      <span>{{ label }}</span>
      <span v-if="field.lockedOnTarget" class="inline-flex items-center gap-1 text-foreground">
        <Lock :size="12" aria-hidden="true" />
        {{ t('book.merge.review.locked') }}
      </span>
      <span v-if="added" class="rounded-full bg-primary/10 px-1.5 py-px text-[0.68rem] font-medium text-primary">{{
        t('book.merge.review.added')
      }}</span>
    </p>
    <p class="text-sm break-words text-foreground" :class="field.field === 'description' ? 'line-clamp-3' : undefined">{{ chosenOption.display }}</p>
    <p class="text-xs text-muted-foreground">{{ chosenOption.sources }}</p>
  </div>
</template>
