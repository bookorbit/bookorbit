<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, RotateCcw, Search } from '@lucide/vue'

export interface MetadataQuery {
  title: string
  author: string
  isbn: string
}

const props = defineProps<{
  defaults: { title?: string; author?: string; isbn?: string }
  busy: boolean
}>()

const emit = defineEmits<{ search: [MetadataQuery] }>()

const { t } = useI18n()
const id = useId()
const titleInput = ref<HTMLTextAreaElement | null>(null)

const initial = (): MetadataQuery => ({ title: props.defaults.title ?? '', author: props.defaults.author ?? '', isbn: props.defaults.isbn ?? '' })
const form = reactive<MetadataQuery>(initial())

watch(
  () => props.defaults,
  () => Object.assign(form, initial()),
)

const canSearch = computed(() => !!(form.title.trim() || form.isbn.trim()))
const edited = computed(() => {
  const base = initial()
  return form.title !== base.title || form.author !== base.author || form.isbn !== base.isbn
})

function submit() {
  if (!canSearch.value) return
  emit('search', { title: form.title.trim(), author: form.author.trim(), isbn: form.isbn.trim() })
}

function useBookDetails() {
  Object.assign(form, initial())
  submit()
}

function focusTitle() {
  titleInput.value?.focus()
  titleInput.value?.select()
}

defineExpose({ focusTitle })
</script>

<template>
  <form
    class="grid gap-[7px] rounded-[10px] border border-border bg-card p-2.5"
    role="search"
    :aria-label="t('book.detail.editMetadata.match.query.label')"
    @submit.prevent="submit"
  >
    <label
      :for="`${id}-title`"
      class="flex min-h-8 min-w-0 items-start gap-2 rounded-lg border border-input bg-background px-2.5 py-[5px] focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20"
    >
      <span class="shrink-0 pt-[3px] text-[9.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{
        t('book.detail.editMetadata.match.query.title')
      }}</span>
      <textarea
        :id="`${id}-title`"
        ref="titleInput"
        v-model="form.title"
        rows="1"
        class="max-h-[4.5rem] min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 outline-none [field-sizing:content]"
        autocomplete="off"
        @keydown.enter.prevent="submit"
      />
    </label>
    <label
      :for="`${id}-author`"
      class="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20"
    >
      <span class="shrink-0 text-[9.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{
        t('book.detail.editMetadata.match.query.author')
      }}</span>
      <input :id="`${id}-author`" v-model="form.author" class="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" autocomplete="off" />
    </label>
    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-[7px]">
      <label
        :for="`${id}-isbn`"
        class="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20"
      >
        <span class="shrink-0 text-[9.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{
          t('book.detail.editMetadata.match.query.isbn')
        }}</span>
        <input
          :id="`${id}-isbn`"
          v-model="form.isbn"
          class="h-full min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
          autocomplete="off"
        />
      </label>
      <button
        type="submit"
        class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold whitespace-nowrap text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
        :disabled="!canSearch"
      >
        <Loader2 v-if="busy" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <Search v-else class="size-4" aria-hidden="true" />
        {{ t('common.search') }}
      </button>
    </div>
    <div v-if="edited" class="flex items-center justify-between gap-2">
      <span class="text-[11.5px] text-muted-foreground">{{ t('book.detail.editMetadata.match.query.edited') }}</span>
      <button
        type="button"
        class="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-foreground hover:bg-muted"
        @click="useBookDetails"
      >
        <RotateCcw class="size-3" aria-hidden="true" />{{ t('book.detail.editMetadata.match.query.useBookDetails') }}
      </button>
    </div>
  </form>
</template>
