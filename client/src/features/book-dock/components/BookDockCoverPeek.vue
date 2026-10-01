<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, BookOpen, Pencil, Wand2, X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger,
} from 'reka-ui'

const props = defineProps<{
  title: string
  currentUrl: string
  proposedUrl: string | null
  applied: boolean
}>()

const { t } = useI18n()

const lightbox = ref<{ src: string; label: string } | null>(null)

function openCurrent() {
  lightbox.value = { src: props.currentUrl, label: t('bookDock.fileList.currentCoverAlt', { title: props.title }) }
}

function openProposed() {
  if (props.proposedUrl) lightbox.value = { src: props.proposedUrl, label: t('bookDock.fileList.newCoverAlt', { title: props.title }) }
}

function onLightboxOpenChange(open: boolean) {
  if (!open) lightbox.value = null
}

function onCoverError(event: Event) {
  ;(event.target as HTMLImageElement).style.visibility = 'hidden'
}

/**
 * Covers are extracted asynchronously, so the first request for a new file 404s and
 * hides the image. Vue reuses the element when the URL later changes, so the hide has
 * to be undone on a successful load or the cover stays invisible forever.
 */
function onCoverLoad(event: Event) {
  ;(event.target as HTMLImageElement).style.visibility = ''
}
</script>

<template>
  <HoverCardRoot :open-delay="250" :close-delay="100">
    <HoverCardTrigger as-child>
      <span class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          data-testid="book-dock-cover-current"
          class="relative flex h-[57px] w-[38px] cursor-zoom-in items-center justify-center overflow-hidden rounded bg-muted ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :aria-label="t('bookDock.fileList.currentCoverAlt', { title: props.title })"
          @click="openCurrent"
        >
          <BookOpen class="absolute size-4 text-muted-foreground" aria-hidden="true" />
          <img :src="props.currentUrl" alt="" class="size-full object-cover" @load="onCoverLoad" @error="onCoverError" />
        </button>
        <template v-if="props.proposedUrl">
          <ArrowRight class="size-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <button
            type="button"
            data-testid="book-dock-cover-proposed"
            class="relative flex h-[57px] w-[38px] cursor-zoom-in items-center justify-center overflow-hidden rounded border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="props.applied ? 'border-emerald-500/45 bg-emerald-500/5' : 'border-amber-500/45 bg-amber-500/5'"
            :aria-label="t('bookDock.fileList.newCoverAlt', { title: props.title })"
            @click="openProposed"
          >
            <img :src="props.proposedUrl" alt="" class="size-full object-cover" @load="onCoverLoad" @error="onCoverError" />
            <span
              v-if="props.applied"
              class="absolute bottom-0 right-0 flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-white"
            >
              <Pencil class="size-2" aria-hidden="true" />
            </span>
            <span v-else class="absolute bottom-0 right-0 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-white">
              <Wand2 class="size-2" aria-hidden="true" />
            </span>
          </button>
        </template>
      </span>
    </HoverCardTrigger>

    <HoverCardPortal>
      <HoverCardContent side="right" align="start" :side-offset="10" class="z-50 rounded-xl border border-border bg-popover p-4 shadow-2xl">
        <div class="flex items-center gap-4">
          <div class="flex flex-col items-center gap-1.5">
            <button
              type="button"
              class="relative flex h-[300px] w-[200px] cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              :aria-label="t('bookDock.fileList.currentCoverAlt', { title: props.title })"
              @click="openCurrent"
            >
              <BookOpen class="absolute size-8 text-muted-foreground" aria-hidden="true" />
              <img :src="props.currentUrl" alt="" class="size-full object-cover" @load="onCoverLoad" @error="onCoverError" />
            </button>
            <span class="text-[11px] font-medium text-muted-foreground">{{ t('bookDock.fileList.colCurrent') }}</span>
          </div>

          <template v-if="props.proposedUrl">
            <ArrowRight class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="flex flex-col items-center gap-1.5">
              <button
                type="button"
                class="relative flex h-[300px] w-[200px] cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                :class="props.applied ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'"
                :aria-label="t('bookDock.fileList.newCoverAlt', { title: props.title })"
                @click="openProposed"
              >
                <img :src="props.proposedUrl" alt="" class="size-full object-cover" @load="onCoverLoad" @error="onCoverError" />
              </button>
              <span
                class="text-[11px] font-medium"
                :class="props.applied ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
              >
                {{ props.applied ? t('bookDock.layout.row.applied') : t('bookDock.fileList.colNew') }}
              </span>
            </div>
          </template>
        </div>
        <p class="mt-2.5 text-center text-[11px] text-muted-foreground">{{ t('bookDock.layout.row.clickToZoom') }}</p>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>

  <DialogRoot :open="!!lightbox" @update:open="onLightboxOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-scrim-media data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 max-h-[90vh] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95"
      >
        <DialogTitle class="sr-only">{{ lightbox?.label ?? t('bookDock.fileList.coverPreview') }}</DialogTitle>
        <DialogDescription class="sr-only">{{ t('bookDock.fileList.coverPreviewDescription') }}</DialogDescription>
        <img v-if="lightbox" :src="lightbox.src" :alt="lightbox.label" class="max-h-[90vh] max-w-[90vw] rounded-md object-contain shadow-2xl" />
        <DialogClose
          class="absolute -right-3 -top-3 rounded-full border border-border bg-background p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :aria-label="t('common.close')"
        >
          <X class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
