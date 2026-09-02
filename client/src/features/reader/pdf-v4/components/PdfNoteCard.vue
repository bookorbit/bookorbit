<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { StickyNote, Trash2 } from '@lucide/vue'
import type { AnnotationItem } from '@bookorbit/types'

const props = defineProps<{
  annotation: AnnotationItem
}>()

const emit = defineEmits<{
  navigate: [annotation: AnnotationItem]
  delete: [id: number]
}>()

const { t } = useI18n()

const pageLabel = computed(() => (props.annotation.pdf ? props.annotation.pdf.page + 1 : props.annotation.pageno))

function handleNavigate() {
  emit('navigate', props.annotation)
}

function handleDelete() {
  emit('delete', props.annotation.id)
}
</script>

<template>
  <div class="group relative mb-1.5 overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-muted-foreground/50">
    <span aria-hidden="true" class="absolute inset-y-2 start-0 w-[3px] rounded-e-full" :style="{ background: props.annotation.color }" />
    <button
      type="button"
      class="block w-full min-w-0 px-3 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      @click="handleNavigate"
    >
      <span class="line-clamp-3 break-words text-xs leading-relaxed text-foreground">{{ props.annotation.text }}</span>
      <span
        v-if="props.annotation.note"
        class="mt-1.5 flex items-start gap-1.5 border-t border-dashed border-border pt-1.5 text-[11px] text-muted-foreground"
      >
        <StickyNote :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span class="line-clamp-2 break-words italic">{{ props.annotation.note }}</span>
      </span>
    </button>
    <div class="flex items-center gap-2 px-3 pb-2">
      <span
        v-if="pageLabel != null"
        class="rounded-full border border-border px-2 py-px text-[10px] font-semibold tabular-nums text-muted-foreground"
      >
        {{ t('reader.pdf.sidebar.page', { page: pageLabel }) }}
      </span>
      <span class="flex-1" />
      <button
        type="button"
        class="flex size-6 items-center justify-center rounded text-muted-foreground opacity-100 transition-opacity hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:focus-visible:opacity-100 [@media(pointer:fine)]:group-hover:opacity-100"
        :aria-label="t('reader.sidebar.deleteHighlight')"
        @click="handleDelete"
      >
        <Trash2 :size="14" />
      </button>
    </div>
  </div>
</template>
