<script setup lang="ts">
import { computed, ref } from 'vue'
import { Undo2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateDismissal, BookDuplicateKind } from '@bookorbit/types'

import { formatDate } from '@/i18n/formatters'

const props = defineProps<{ dismissals: BookDuplicateDismissal[] }>()
const emit = defineEmits<{ restore: [bookIdA: number, bookIdB: number, kind: BookDuplicateKind] }>()

const { t } = useI18n()
const expanded = ref(false)

const count = computed(() => props.dismissals.length)

function handleToggle(): void {
  expanded.value = !expanded.value
}

/** One side of the pair, with its edition detail when both share a title. */
function sideLabel(title: string | null, detail: string | null | undefined): string {
  const name = title ?? t('book.untitled')
  return detail ? t('tools.bookDuplicates.dismissed.withDetail', { title: name, detail }) : name
}

function handleRestore(dismissal: BookDuplicateDismissal): void {
  emit('restore', dismissal.bookIdA, dismissal.bookIdB, dismissal.kind)
}
</script>

<template>
  <section v-if="count > 0" class="shrink-0">
    <button
      type="button"
      class="rounded-md text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      :aria-expanded="expanded"
      @click="handleToggle"
    >
      {{ expanded ? t('tools.bookDuplicates.dismissed.hide') : t('tools.bookDuplicates.dismissed.show', { count }, count) }}
    </button>

    <ul v-if="expanded" class="mt-2 grid max-h-52 gap-1 overflow-y-auto">
      <li
        v-for="dismissal in dismissals"
        :key="`${dismissal.kind}-${dismissal.bookIdA}-${dismissal.bookIdB}`"
        class="flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-[12px]"
      >
        <span class="min-w-0 flex-1 truncate text-foreground">
          {{
            t('tools.bookDuplicates.pairLabel', {
              first: sideLabel(dismissal.titleA, dismissal.detailA),
              second: sideLabel(dismissal.titleB, dismissal.detailB),
            })
          }}
        </span>
        <span v-if="dismissal.kind !== 'duplicate'" class="shrink-0 text-muted-foreground">{{
          t(`tools.bookDuplicates.kinds.${dismissal.kind}`)
        }}</span>
        <span class="shrink-0 text-muted-foreground">{{ formatDate(new Date(dismissal.createdAt)) }}</span>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t('tools.bookDuplicates.dismissed.restore')"
          @click="handleRestore(dismissal)"
        >
          <Undo2 class="size-3.5" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </section>
</template>
