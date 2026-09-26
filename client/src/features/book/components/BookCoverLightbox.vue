<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { BookDetail, CoverMedium } from '@bookorbit/types'
import { useCoverVersions } from '../composables/useCoverVersions'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { faceMedium } from '../lib/cover-slots'
import CoverMediumSwitch from './CoverMediumSwitch.vue'

const props = defineProps<{
  open: boolean
  book: Pick<BookDetail, 'id' | 'title' | 'covers' | 'coverVersion'>
  /** The slot to open on. Without one the lightbox opens on the face, as the page shows it. */
  medium?: CoverMedium | null
  /** Unsaved editor images, shown in place of the saved slot they would replace. */
  previews?: Partial<Record<CoverMedium, string | null>>
}>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

function hasImage(medium: CoverMedium): boolean {
  return Boolean(props.previews?.[medium]) || props.book.covers[medium] !== null
}

const canSwitch = computed(() => hasImage('ebook') && hasImage('audio'))
const selected = ref<CoverMedium | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    selected.value = props.medium ?? (canSwitch.value ? faceMedium(props.book, coverAspectRatio.value) : null)
  },
  { immediate: true },
)

const src = computed(() => {
  const medium = selected.value
  if (!medium) return coverUrl(props.book.id, 'cover', props.book.coverVersion)
  const preview = props.previews?.[medium]
  if (preview) return preview
  const slot = props.book.covers[medium]
  return slot ? coverUrl(props.book.id, 'cover', slot.updatedAt, medium) : coverUrl(props.book.id, 'cover', props.book.coverVersion)
})

const switchValue = computed<CoverMedium>({
  get: () => selected.value ?? faceMedium(props.book, coverAspectRatio.value),
  set: (medium) => {
    selected.value = medium
  },
})

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
      >
        <DialogTitle class="sr-only">{{ t('book.detail.coverLightbox.title') }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t('book.detail.coverLightbox.description') }}</DialogDescription>
        <CoverMediumSwitch v-if="canSwitch" v-model="switchValue" :label="t('book.detail.coverLightbox.switchLabel')" />
        <div class="relative min-h-0">
          <img
            :src="src"
            :alt="props.book.title ?? ''"
            class="rounded-md object-contain shadow-2xl"
            :class="canSwitch ? 'max-h-[calc(90vh-3rem)] max-w-[90vw]' : 'max-h-[90vh] max-w-[90vw]'"
          />
          <DialogClose
            class="absolute -top-3 -right-3 rounded-full border border-border bg-background p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :aria-label="t('common.close')"
          >
            <X class="size-4" aria-hidden="true" />
          </DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
