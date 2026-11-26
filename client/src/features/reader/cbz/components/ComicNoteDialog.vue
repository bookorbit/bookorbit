<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export interface ComicNoteDraft {
  page: number
  note: string
  color: string
}

const props = defineProps<{
  mode: 'add' | 'edit'
  /** Zero-based pages the note can go on, in page order. */
  pages: readonly number[]
  initialPage: number
  initialNote?: string
  initialColor: string
  bookTitle?: string | null
  thumbnailUrl: (page: number) => string
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [draft: ComicNoteDraft]
  cancel: []
}>()

const { t } = useI18n()

const selectedPage = ref(props.pages.includes(props.initialPage) ? props.initialPage : (props.pages[0] ?? props.initialPage))
const text = ref(props.initialNote ?? '')
const color = ref(props.initialColor)
const textarea = ref<InstanceType<typeof Textarea> | null>(null)

// Opened from code rather than a DialogTrigger, so reka has nothing to hand focus back to on close.
const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null

const choosePage = computed(() => props.pages.length > 1)
const canSave = computed(() => !props.saving && text.value.trim() !== '')

// A colour that came from a device keeps its own swatch, so editing the note never repaints it.
const swatches = computed(() => {
  const palette = ANNOTATION_HIGHLIGHT_COLORS.map((entry) => ({ hex: entry.hex, label: t(`annotations.colors.${entry.name}`) }))
  const current = props.initialColor.toUpperCase()
  if (palette.some((swatch) => swatch.hex.toUpperCase() === current)) return palette
  return [{ hex: props.initialColor, label: t('reader.sidebar.customColor', { color: props.initialColor }) }, ...palette]
})

function isSelectedColor(hex: string) {
  return hex.toUpperCase() === color.value.toUpperCase()
}

function handleOpenChange(open: boolean) {
  if (!open && !props.saving) emit('cancel')
}

function handleDismissWhileSaving(event: Event) {
  if (props.saving) event.preventDefault()
}

function handleOpenAutoFocus(event: Event) {
  event.preventDefault()
  const element = textarea.value?.$el
  if (element instanceof HTMLTextAreaElement) {
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }
}

function handleCloseAutoFocus(event: Event) {
  if (!returnFocusTo?.isConnected) return
  event.preventDefault()
  returnFocusTo.focus()
}

function handleSelectPage(page: number) {
  selectedPage.value = page
}

function handleSelectColor(hex: string) {
  color.value = hex
}

function handleCancel() {
  if (!props.saving) emit('cancel')
}

function handleSave() {
  if (!canSave.value) return
  emit('save', { page: selectedPage.value, note: text.value.trim(), color: color.value })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  handleSave()
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-lg bg-card p-4 text-card-foreground shadow-2xl focus-visible:outline-none"
        data-testid="comic-note-dialog"
        @open-auto-focus="handleOpenAutoFocus"
        @close-auto-focus="handleCloseAutoFocus"
        @escape-key-down="handleDismissWhileSaving"
        @pointer-down-outside="handleDismissWhileSaving"
        @interact-outside="handleDismissWhileSaving"
      >
        <DialogTitle class="text-sm font-medium">
          {{ props.mode === 'edit' ? t('reader.cbz.notes.editTitle') : t('reader.cbz.notes.addTitle') }}
        </DialogTitle>

        <fieldset v-if="choosePage" class="grid grid-cols-2 gap-2">
          <legend class="sr-only">{{ t('reader.cbz.notes.whichPage') }}</legend>
          <label
            v-for="page in props.pages"
            :key="page"
            class="flex cursor-pointer items-center gap-2 rounded-md border p-1.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
            :class="selectedPage === page ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'"
          >
            <input
              type="radio"
              name="comic-note-page"
              class="sr-only"
              :value="page"
              :checked="selectedPage === page"
              :disabled="props.saving"
              @change="handleSelectPage(page)"
            />
            <img :src="props.thumbnailUrl(page)" alt="" class="h-[46px] w-[30px] shrink-0 rounded-sm bg-muted object-cover ring-1 ring-border" />
            <span class="text-xs font-semibold tabular-nums" :class="selectedPage === page ? 'text-primary' : 'text-foreground'">
              {{ t('reader.cbz.notes.page', { page: page + 1 }) }}
            </span>
          </label>
        </fieldset>
        <div v-else class="flex items-center gap-3">
          <img
            :src="props.thumbnailUrl(selectedPage)"
            alt=""
            class="h-[52px] w-[34px] shrink-0 rounded-sm bg-muted object-cover ring-1 ring-border"
          />
          <div class="min-w-0">
            <p class="text-xs font-semibold tabular-nums text-foreground">{{ t('reader.cbz.notes.page', { page: selectedPage + 1 }) }}</p>
            <p v-if="props.bookTitle" class="truncate text-xs text-muted-foreground">{{ props.bookTitle }}</p>
          </div>
        </div>
        <DialogDescription class="sr-only">{{ t('reader.cbz.notes.saveShortcut') }}</DialogDescription>

        <Textarea
          ref="textarea"
          v-model="text"
          :disabled="props.saving"
          :aria-label="t('reader.cbz.notes.note')"
          :placeholder="t('reader.note.placeholder')"
          class="min-h-[88px] resize-none"
          rows="4"
          @keydown="handleKeydown"
        />

        <fieldset class="flex flex-wrap items-center gap-2">
          <legend class="sr-only">{{ t('reader.cbz.notes.color') }}</legend>
          <label
            v-for="swatch in swatches"
            :key="swatch.hex"
            class="relative size-6 cursor-pointer rounded-full transition-shadow has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-primary"
            :class="isSelectedColor(swatch.hex) ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : ''"
            :style="{ background: swatch.hex }"
            :title="swatch.label"
          >
            <input
              type="radio"
              name="comic-note-color"
              class="sr-only"
              :value="swatch.hex"
              :aria-label="swatch.label"
              :checked="isSelectedColor(swatch.hex)"
              :disabled="props.saving"
              @change="handleSelectColor(swatch.hex)"
            />
          </label>
        </fieldset>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" :disabled="props.saving" @click="handleCancel">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" :disabled="!canSave" data-testid="comic-note-save" @click="handleSave">
            {{ t('common.save') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
