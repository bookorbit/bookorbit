<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import ChipInput from '@/components/ui/ChipInput.vue'
import InputWithSuggestions from '@/components/ui/InputWithSuggestions.vue'
import SeriesMembershipEditor from '@/features/book/components/detail/tabs/SeriesMembershipEditor.vue'
import { useAuthorSearch } from '@/features/book/composables/useAuthorSearch'
import { useGenreSearch, useTagSearch } from '@/features/book/composables/useTagSearch'
import { useNarratorSearch } from '@/features/book/composables/useNarratorSearch'
import { usePublisherSearch, useSeriesNameSearch, useLanguageSearch } from '@/features/book/composables/useMetadataFieldSearch'
import type { BulkEditFields, ArrayMode } from '@/features/book/composables/useBulkEditMetadata'
import { normalizeSeriesMemberships, type EditableSeriesMembership } from '@/features/book/composables/useMetadataEditor'
import {
  BULK_EDITABLE_ARRAY_FIELDS,
  BULK_EDITABLE_SCALAR_FIELDS,
  BULK_EDITABLE_FIELD_LABELS,
  type BulkEditableArrayField,
  type BulkEditableScalarField,
  type BulkEditableField,
} from '@/features/book/composables/useBookBulkActions'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

type UIArrayMode = ArrayMode | 'clear'

const props = defineProps<{
  open: boolean
  bookCount: number
  submitting: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [fields: BulkEditFields]
}>()

const ARRAY_FIELDS = BULK_EDITABLE_ARRAY_FIELDS
const SCALAR_FIELDS = BULK_EDITABLE_SCALAR_FIELDS

type ArrayFieldKey = BulkEditableArrayField
type ScalarFieldKey = BulkEditableScalarField
type FieldKey = BulkEditableField

const FIELD_LABELS = BULK_EDITABLE_FIELD_LABELS

const MODE_LABELS = computed<Record<UIArrayMode, string>>(() => ({
  add: t('book.bulkEdit.mode.add'),
  remove: t('book.bulkEdit.mode.remove'),
  replace: t('book.bulkEdit.mode.replace'),
  clear: t('book.bulkEdit.mode.clear'),
}))

const { search: searchAuthors } = useAuthorSearch()
const { search: searchGenres } = useGenreSearch()
const { search: searchTags } = useTagSearch()
const { search: searchNarrators } = useNarratorSearch()
const { search: searchPublishers } = usePublisherSearch()
const { search: searchSeries } = useSeriesNameSearch()
const { search: searchLanguages } = useLanguageSearch()

const SEARCH_FNS: Record<ArrayFieldKey, (q: string) => Promise<string[]>> = {
  authors: searchAuthors,
  genres: searchGenres,
  tags: searchTags,
  narrators: searchNarrators,
}

const SUGGESTION_FNS: Partial<Record<ScalarFieldKey, (q: string) => Promise<string[]>>> = {
  seriesName: searchSeries,
  publisher: searchPublishers,
  language: searchLanguages,
}

const enabledFields = reactive<Record<FieldKey, boolean>>({
  authors: false,
  genres: false,
  tags: false,
  narrators: false,
  seriesName: false,
  publisher: false,
  language: false,
  publishedYear: false,
})

const arrayModes = reactive<Record<ArrayFieldKey, UIArrayMode>>({
  authors: 'add',
  genres: 'add',
  tags: 'add',
  narrators: 'add',
})

const arrayValues = reactive<Record<ArrayFieldKey, string[]>>({
  authors: [],
  genres: [],
  tags: [],
  narrators: [],
})

const scalarValues = reactive<Record<ScalarFieldKey, string>>({
  seriesName: '',
  publisher: '',
  language: '',
  publishedYear: '',
})
const seriesMembershipValues = ref<EditableSeriesMembership[]>([])

const hasAnyEnabledField = computed(() => Object.values(enabledFields).some(Boolean))

const yearError = computed(() => {
  if (!enabledFields.publishedYear) return null
  const raw = scalarValues.publishedYear.trim()
  if (!raw) return null
  if (!/^\d+$/.test(raw)) return t('book.bulkEdit.invalidYear')
  return null
})

const canConfirm = computed(() => {
  if (!hasAnyEnabledField.value) return false
  if (yearError.value) return false

  for (const key of ARRAY_FIELDS) {
    if (!enabledFields[key]) continue
    if (arrayModes[key] === 'clear') continue
    if (arrayValues[key].length === 0) return false
  }

  return true
})

function buildFields(): BulkEditFields {
  const fields: BulkEditFields = {}

  for (const key of ARRAY_FIELDS) {
    if (!enabledFields[key]) continue
    if (arrayModes[key] === 'clear') {
      fields[key] = { mode: 'replace', values: [] }
    } else {
      fields[key] = { mode: arrayModes[key], values: arrayValues[key] }
    }
  }

  for (const key of SCALAR_FIELDS) {
    if (!enabledFields[key]) continue
    if (key === 'seriesName') {
      fields.seriesMemberships = normalizeSeriesMemberships(seriesMembershipValues.value)
      continue
    }
    if (key === 'publishedYear') {
      const num = scalarValues[key].trim() ? parseInt(scalarValues[key], 10) : null
      fields[key] = { value: num !== null && Number.isNaN(num) ? null : num }
    } else {
      fields[key] = { value: scalarValues[key].trim() || null }
    }
  }

  return fields
}

function handleConfirm() {
  if (!canConfirm.value || props.submitting) return
  emit('confirm', buildFields())
}

function resetForm() {
  for (const key of [...ARRAY_FIELDS, ...SCALAR_FIELDS]) {
    enabledFields[key] = false
  }
  for (const key of ARRAY_FIELDS) {
    arrayModes[key] = 'add'
    arrayValues[key] = []
  }
  for (const key of SCALAR_FIELDS) {
    scalarValues[key] = ''
  }
  seriesMembershipValues.value = []
}

function handleClose() {
  if (props.submitting) return
  emit('update:open', false)
}

function toggleField(key: FieldKey) {
  enabledFields[key] = !enabledFields[key]
}

function setArrayMode(key: ArrayFieldKey, mode: UIArrayMode) {
  arrayModes[key] = mode
}

function handleSeriesMembershipsUpdate(values: EditableSeriesMembership[]) {
  seriesMembershipValues.value = values
}

watch(
  () => props.open,
  (open) => {
    if (!open) resetForm()
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-lg mx-4 max-h-[90vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 class="text-base font-semibold text-foreground">{{ t('book.bulkEdit.title', { count: bookCount }, bookCount) }}</h2>
          <button
            type="button"
            class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="submitting"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </div>

        <!-- Scrollable body -->
        <div class="overflow-y-auto px-6 py-4 space-y-4 min-h-0">
          <p class="text-sm text-muted-foreground">{{ t('book.bulkEdit.instructions') }}</p>

          <!-- Array fields -->
          <div v-for="key in ARRAY_FIELDS" :key="key" class="space-y-2">
            <button type="button" class="flex items-center gap-2 w-full text-left" @click="toggleField(key)">
              <div
                :class="[
                  'w-4 h-4 rounded border transition-colors flex items-center justify-center shrink-0',
                  enabledFields[key] ? 'bg-primary border-primary' : 'border-muted-foreground/40 hover:border-foreground/60',
                ]"
              >
                <svg
                  v-if="enabledFields[key]"
                  viewBox="0 0 16 16"
                  class="w-3 h-3 text-primary-foreground"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3.5 8 6.5 11 12.5 5" />
                </svg>
              </div>
              <span class="text-sm font-medium text-foreground">{{ FIELD_LABELS[key] }}</span>
            </button>

            <div v-if="enabledFields[key]" class="pl-6 space-y-2">
              <div class="flex gap-1.5">
                <button
                  v-for="m in ['add', 'remove', 'replace', 'clear'] as UIArrayMode[]"
                  :key="m"
                  type="button"
                  :class="[
                    'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                    arrayModes[key] === m
                      ? m === 'clear'
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground',
                  ]"
                  @click="setArrayMode(key, m)"
                >
                  {{ MODE_LABELS[m] }}
                </button>
              </div>

              <p v-if="arrayModes[key] === 'clear'" class="text-xs text-destructive">
                {{ t('book.bulkEdit.clearWarning', { field: FIELD_LABELS[key].toLowerCase() }) }}
              </p>
              <ChipInput
                v-else
                v-model="arrayValues[key]"
                :search-fn="SEARCH_FNS[key]"
                :placeholder="t('book.bulkEdit.searchPlaceholder', { field: FIELD_LABELS[key].toLowerCase() })"
              />
            </div>
          </div>

          <!-- Scalar fields -->
          <div v-for="key in SCALAR_FIELDS" :key="key" class="space-y-2">
            <button type="button" class="flex items-center gap-2 w-full text-left" @click="toggleField(key)">
              <div
                :class="[
                  'w-4 h-4 rounded border transition-colors flex items-center justify-center shrink-0',
                  enabledFields[key] ? 'bg-primary border-primary' : 'border-muted-foreground/40 hover:border-foreground/60',
                ]"
              >
                <svg
                  v-if="enabledFields[key]"
                  viewBox="0 0 16 16"
                  class="w-3 h-3 text-primary-foreground"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3.5 8 6.5 11 12.5 5" />
                </svg>
              </div>
              <span class="text-sm font-medium text-foreground">{{ FIELD_LABELS[key] }}</span>
            </button>

            <div v-if="enabledFields[key]" class="pl-6">
              <SeriesMembershipEditor
                v-if="key === 'seriesName'"
                :model-value="seriesMembershipValues"
                :search-fn="searchSeries"
                @update:model-value="handleSeriesMembershipsUpdate"
              />
              <InputWithSuggestions
                v-else-if="SUGGESTION_FNS[key]"
                :model-value="scalarValues[key] || null"
                :search-fn="SUGGESTION_FNS[key]!"
                :placeholder="t('book.bulkEdit.enterPlaceholder', { field: FIELD_LABELS[key].toLowerCase() })"
                class="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                @update:model-value="scalarValues[key] = $event ?? ''"
              />
              <input
                v-else
                v-model="scalarValues[key]"
                type="text"
                :inputmode="key === 'publishedYear' ? 'numeric' : undefined"
                :placeholder="
                  key === 'publishedYear'
                    ? t('book.bulkEdit.yearPlaceholder')
                    : t('book.bulkEdit.enterPlaceholder', { field: FIELD_LABELS[key].toLowerCase() })
                "
                class="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p v-if="key === 'publishedYear' && yearError" class="text-xs text-destructive mt-1">
                {{ yearError }}
              </p>
              <p v-else class="text-xs text-muted-foreground mt-1">{{ t('book.bulkEdit.leaveEmptyHint') }}</p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            type="button"
            class="h-9 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="submitting"
            @click="handleClose"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            :disabled="!canConfirm || submitting"
            class="h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            @click="handleConfirm"
          >
            <svg v-if="submitting" class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {{ submitting ? t('book.bulkEdit.applying') : t('book.bulkEdit.apply') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
