<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { History, Link2, Loader2, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { DeleteEditionsChoice } from '@/features/book/lib/book-editions'
import type { DeleteScope } from '@/features/book/composables/useDeleteBook'
import { formatKeyCode } from '@/features/book/lib/book-formats'
import { formatConjunctionList, formatList } from '@/i18n/formatters'

const props = withDefaults(
  defineProps<{
    open: boolean
    deleting: boolean
    /** The book is linked with others; only this one is deleted (G6). */
    linked?: boolean
    /** Its other editions, when it has some: the prompt then asks whether they go too. */
    editions?: DeleteEditionsChoice | null
  }>(),
  { linked: false, editions: null },
)
const emit = defineEmits<{ confirm: [scope: DeleteScope]; cancel: [] }>()

const { t } = useI18n()
const choiceName = `delete-scope-${useId()}`
const scope = ref<DeleteScope>('edition')

watch(
  () => [props.open, props.editions] as const,
  () => {
    scope.value = 'edition'
  },
)

const choice = computed(() => {
  const editions = props.editions
  if (!editions || editions.others.length === 0) return null
  const formats = formatConjunctionList(editions.current.formats.map((format) => formatKeyCode(format)))
  const libraries = [...new Set(editions.others.map((other) => other.libraryName))]
  return {
    thisDetail: t('book.editions.delete.thisDetail', { label: editions.current.label, formats, library: editions.current.libraryName }),
    allTitle: t('book.editions.delete.all', { count: editions.others.length + 1 }),
    allDetail: t('book.editions.delete.allDetail', {
      labels: formatList(editions.others.map((other) => other.label)),
      libraries: formatConjunctionList(libraries),
    }),
    kept: editions.kept,
  }
})
const showLinkedNote = computed(() => props.linked && choice.value === null)

function handleCancel() {
  emit('cancel')
}

function handleConfirm() {
  emit('confirm', choice.value ? scope.value : 'edition')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-scrim" @click="handleCancel" />
      <div class="relative z-10 w-full max-w-sm mx-4 bg-card border border-border rounded-lg shadow-2xl p-6">
        <div class="flex items-start gap-4 mb-5">
          <div class="shrink-0 h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <Trash2 class="text-destructive" :size="18" />
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-foreground">{{ t('book.deleteDialog.title') }}</h2>
            <p class="text-sm text-muted-foreground mt-1">
              {{ t('book.deleteDialog.description') }}
            </p>
            <div
              v-if="choice"
              class="mt-3.5 grid gap-1.5"
              role="radiogroup"
              :aria-label="t('book.editions.delete.groupLabel')"
              data-testid="delete-editions-choice"
            >
              <label
                class="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 rounded-lg border px-[11px] py-[9px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                :class="scope === 'edition' ? 'border-destructive/55 bg-destructive/8' : 'border-border bg-background'"
                data-testid="delete-scope-edition"
              >
                <input v-model="scope" type="radio" :name="choiceName" value="edition" class="sr-only" />
                <span
                  class="col-start-1 row-span-2 row-start-1 mt-0.5 grid size-4 place-items-center rounded-full border-[1.5px]"
                  :class="scope === 'edition' ? 'border-destructive' : 'border-muted-foreground'"
                  aria-hidden="true"
                >
                  <span v-if="scope === 'edition'" class="size-2 rounded-full bg-destructive" />
                </span>
                <span class="col-start-2 text-[13.5px] font-semibold text-foreground">{{ t('book.editions.delete.this') }}</span>
                <span class="col-start-2 text-xs leading-4 text-muted-foreground" dir="auto">{{ choice.thisDetail }}</span>
              </label>
              <label
                class="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 rounded-lg border px-[11px] py-[9px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                :class="scope === 'all' ? 'border-destructive/55 bg-destructive/8' : 'border-border bg-background'"
                data-testid="delete-scope-all"
              >
                <input v-model="scope" type="radio" :name="choiceName" value="all" class="sr-only" />
                <span
                  class="col-start-1 row-span-2 row-start-1 mt-0.5 grid size-4 place-items-center rounded-full border-[1.5px]"
                  :class="scope === 'all' ? 'border-destructive' : 'border-muted-foreground'"
                  aria-hidden="true"
                >
                  <span v-if="scope === 'all'" class="size-2 rounded-full bg-destructive" />
                </span>
                <span class="col-start-2 text-[13.5px] font-semibold text-foreground">{{ choice.allTitle }}</span>
                <span class="col-start-2 text-xs leading-4 text-muted-foreground" dir="auto">{{ choice.allDetail }}</span>
              </label>
              <p v-if="choice.kept > 0" class="text-xs leading-4 text-muted-foreground" data-testid="delete-editions-kept">
                {{ t('book.editions.delete.kept', { count: choice.kept }) }}
              </p>
            </div>
            <p class="mt-3 flex gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-2 text-[12.5px] leading-[17px] text-foreground">
              <History class="mt-px shrink-0 text-primary" :size="14" aria-hidden="true" />
              {{ t('book.deleteDialog.keepsHistory') }}
            </p>
            <p v-if="showLinkedNote" class="mt-2 flex gap-2 text-[12.5px] leading-[17px] text-muted-foreground" data-testid="delete-linked-note">
              <Link2 class="mt-px shrink-0" :size="14" aria-hidden="true" />
              {{ t('book.deleteDialog.linkedNotAffected') }}
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="h-9 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="deleting"
            @click="handleCancel"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="h-9 px-4 rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-2 disabled:opacity-50"
            :disabled="deleting"
            data-testid="delete-confirm"
            @click="handleConfirm"
          >
            <Loader2 v-if="deleting" class="animate-spin" :size="14" />
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
