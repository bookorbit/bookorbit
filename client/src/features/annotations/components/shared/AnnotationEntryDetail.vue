<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Check, Contrast, Copy, Highlighter, Strikethrough, Trash2, Underline, Waves, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubItem, type AnnotationItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'
import AnnotationSyncDetailPanel from '../AnnotationSyncDetailPanel.vue'

type DetailAnnotation = AnnotationItem | AnnotationHubItem

const props = defineProps<{ annotation: DetailAnnotation; canJump: boolean; trashed: boolean }>()

const emit = defineEmits<{
  close: []
  jump: [annotation: DetailAnnotation]
  trash: [id: number]
  updateNote: [id: number, note: string | null]
  updateColor: [id: number, color: string]
  updateStyle: [id: number, style: string]
}>()

const { t } = useI18n()

const STYLES = computed(() => [
  { value: 'highlight', label: t('annotations.styles.highlight'), icon: Highlighter },
  { value: 'underline', label: t('annotations.styles.underline'), icon: Underline },
  { value: 'strikethrough', label: t('annotations.styles.strike'), icon: Strikethrough },
  { value: 'squiggly', label: t('annotations.styles.squiggle'), icon: Waves },
  { value: 'invert', label: t('annotations.styles.invert'), icon: Contrast },
])

const draft = ref(props.annotation.note ?? '')
const dirty = computed(() => draft.value.trim() !== (props.annotation.note ?? '').trim())

watch(
  () => props.annotation.id,
  () => {
    draft.value = props.annotation.note ?? ''
  },
)

function handleSaveNote() {
  const next = draft.value.trim()
  emit('updateNote', props.annotation.id, next === '' ? null : next)
}

function handleResetNote() {
  draft.value = props.annotation.note ?? ''
}

function handleClose() {
  emit('close')
}

function handleJump() {
  emit('jump', props.annotation)
}

function handleTrash() {
  emit('trash', props.annotation.id)
}

async function handleCopy() {
  const ok = await copyToClipboard(props.annotation.text)
  if (ok) toast.success(t('annotations.listItem.copied'))
}

function handlePickColor(color: string) {
  emit('updateColor', props.annotation.id, color)
}

function handlePickStyle(style: string) {
  emit('updateStyle', props.annotation.id, style)
}
</script>

<template>
  <div class="mt-3 grid gap-3.5 rounded-xl border border-border bg-muted/40 p-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
    <div class="min-w-0">
      <label class="text-[8.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground" :for="`hub-note-${annotation.id}`">
        {{ t('annotations.hub.yourNote') }}
      </label>
      <textarea
        :id="`hub-note-${annotation.id}`"
        v-model="draft"
        rows="2"
        :disabled="trashed"
        :placeholder="t('annotations.hub.notePlaceholder')"
        class="mt-1.5 min-h-[52px] w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-primary disabled:opacity-60"
      />
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" class="gap-1.5" :disabled="!dirty || trashed" @click="handleSaveNote">
          <Check :size="11" />
          {{ t('common.save') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="!dirty" @click="handleResetNote">{{ t('common.cancel') }}</Button>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" class="gap-1.5" @click="handleCopy">
            <Copy :size="11" />
            {{ t('annotations.listItem.copyText') }}
          </Button>
          <Button v-if="canJump" variant="outline" size="sm" class="gap-1.5" @click="handleJump">
            <BookOpen :size="11" />
            {{ t('annotations.hub.openAtThisPage') }}
          </Button>
          <Button v-if="!trashed" variant="outline" size="sm" class="gap-1.5 text-destructive" @click="handleTrash">
            <Trash2 :size="11" />
            <span class="sr-only">{{ t('annotations.listItem.moveToTrash') }}</span>
          </Button>
        </div>
      </div>

      <span class="mt-3 block text-[8.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground">{{
        t('annotations.listItem.colorAndStyle')
      }}</span>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          v-for="color in ANNOTATION_HIGHLIGHT_COLORS"
          :key="color.hex"
          type="button"
          :disabled="trashed"
          class="size-[18px] rounded-full border-2 transition-transform disabled:opacity-50"
          :class="color.hex === annotation.color ? 'scale-110 border-foreground' : 'border-transparent'"
          :style="{ backgroundColor: color.hex }"
          :aria-label="color.label"
          :aria-pressed="color.hex === annotation.color"
          @click="handlePickColor(color.hex)"
        />
        <span class="w-2" />
        <button
          v-for="style in STYLES"
          :key="style.value"
          type="button"
          :disabled="trashed"
          class="grid h-[22px] w-6 place-items-center rounded-md border transition-colors disabled:opacity-50"
          :class="
            style.value === annotation.style
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          "
          :aria-label="style.label"
          :aria-pressed="style.value === annotation.style"
          @click="handlePickStyle(style.value)"
        >
          <component :is="style.icon" :size="12" />
        </button>
      </div>
    </div>

    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-[8.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground">{{ t('annotations.hub.positionAndSync') }}</span>
        <button
          type="button"
          class="ml-auto grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          :aria-label="t('common.close')"
          @click="handleClose"
        >
          <X :size="12" />
        </button>
      </div>
      <AnnotationSyncDetailPanel :annotation-id="annotation.id" class="mt-1.5" />
    </div>
  </div>
</template>
