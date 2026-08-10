<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { AlertTriangle, ArrowRight, Check, FolderInput, Loader2, Search, Smartphone, Users } from '@lucide/vue'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AppIcon from '@/components/AppIcon.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useVirtualKeyboard } from '@/composables/useVirtualKeyboard'
import type { BookMoveJobCollisionPolicy, BookSelectionPayload, Library } from '@bookorbit/types'

import { useMoveToLibrary } from '../composables/useMoveToLibrary'

const props = defineProps<{
  open: boolean
  selectionPayload: BookSelectionPayload
  selectedCount: number
  currentLibraryId?: number | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  moved: []
}>()

const { t } = useI18n()
const { libraries, fetchLibraries, refreshLibraries } = useLibraries()
const { keyboardHeight } = useVirtualKeyboard()
const move = useMoveToLibrary()

const search = ref('')
const selectedLibraryId = ref<number | null>(null)
const selectedFolderId = ref<number | null>(null)
// Captured when the sheet opens: finishing a move clears the selection, so the
// live count would drop to zero while the sheet is still showing its result.
const movingCount = ref(0)

const filteredLibraries = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return libraries.value
  return libraries.value.filter((library) => library.name.toLowerCase().includes(term))
})

const selectedLibrary = computed(() => libraries.value.find((library) => library.id === selectedLibraryId.value) ?? null)

const canSubmit = computed(
  () => selectedLibraryId.value !== null && selectedFolderId.value !== null && !move.previewLoading.value && move.step.value !== 'progress',
)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    move.reset()
    search.value = ''
    selectedLibraryId.value = null
    selectedFolderId.value = null
    movingCount.value = props.selectedCount
    await fetchLibraries()
  },
  { immediate: true },
)

function isCurrentLibrary(library: Library): boolean {
  return props.currentLibraryId != null && library.id === props.currentLibraryId
}

function folderCount(library: Library): number {
  return library.folders?.length ?? 0
}

function selectLibrary(library: Library): void {
  if (isCurrentLibrary(library)) return
  selectedLibraryId.value = library.id
  selectedFolderId.value = library.folders?.[0]?.id ?? null
  move.preview.value = null
}

function selectFolder(folderId: number): void {
  selectedFolderId.value = folderId
  move.preview.value = null
}

async function handleContinue(): Promise<void> {
  if (selectedLibraryId.value === null || selectedFolderId.value === null) return

  const result = await move.loadPreview(props.selectionPayload, selectedLibraryId.value, selectedFolderId.value)
  if (!result) return

  if (result.readyCount === 0 && result.collisionCount === 0) {
    move.step.value = 'review'
    return
  }

  // Skip the review step only when nothing needs a decision.
  if (result.requiresReview) {
    move.step.value = 'review'
    return
  }

  await runMove()
}

async function handleReviewConfirm(): Promise<void> {
  await runMove()
}

async function runMove(): Promise<void> {
  if (selectedLibraryId.value === null || selectedFolderId.value === null) return

  const summary = await move.execute(props.selectionPayload, selectedLibraryId.value, selectedFolderId.value)
  if (!summary) return

  const movedCount = summary.succeeded + summary.merged
  if (movedCount > 0) {
    // Book counts changed in both the source and target libraries.
    await refreshLibraries()
    emit('moved')
  }

  if (summary.failed > 0) {
    toast.warning(t('book.move.toast.partial', { moved: movedCount, failed: summary.failed }))
  } else if (movedCount > 0) {
    toast.success(t('book.move.toast.success', { count: movedCount, library: selectedLibrary.value?.name ?? '' }))
  }
}

function handleBack(): void {
  move.step.value = 'destination'
}

function handleClose(): void {
  emit('update:open', false)
}

function handleCancel(): void {
  move.cancel()
}

function handlePolicyAll(policy: BookMoveJobCollisionPolicy): void {
  move.applyPolicyToAll(policy)
}

function handleSuggestedAll(): void {
  handlePolicyAll('suggested')
}

function handleKeepBothAll(): void {
  handlePolicyAll('keep_both')
}

function handleSkipAll(): void {
  handlePolicyAll('skip')
}

function handleMergeAll(): void {
  handlePolicyAll('merge')
}

function ineligibleLabel(reason: string, detail?: string): string {
  return t(`book.move.ineligible.${reason}`, { detail: detail ?? '' })
}

function collisionLabel(kind: string): string {
  return t(`book.move.collision.${kind}`)
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent
      side="bottom"
      class="max-h-[85vh] overflow-y-auto sm:inset-x-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-lg sm:rounded-t-lg"
      :style="keyboardHeight > 0 ? { bottom: `${keyboardHeight}px` } : undefined"
    >
      <SheetHeader>
        <SheetTitle class="flex items-center gap-2">
          <FolderInput :size="16" />
          {{ t('book.move.title', { count: movingCount }) }}
        </SheetTitle>
      </SheetHeader>

      <div class="px-4 pb-4 space-y-4">
        <!-- Step 1: pick a destination -->
        <template v-if="move.step.value === 'destination'">
          <p class="text-xs text-muted-foreground">{{ t('book.move.subtitle') }}</p>

          <div class="relative">
            <Search :size="14" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="search" :placeholder="t('book.move.searchPlaceholder')" class="ps-9" />
          </div>

          <div v-if="move.previewError.value" class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {{ move.previewError.value }}
          </div>

          <ul class="space-y-1.5">
            <li v-for="library in filteredLibraries" :key="library.id">
              <button
                type="button"
                class="w-full flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors"
                :class="[
                  selectedLibraryId === library.id ? 'border-primary ring-1 ring-primary' : 'border-border',
                  isCurrentLibrary(library) ? 'opacity-55 cursor-not-allowed' : 'hover:bg-muted cursor-pointer',
                ]"
                :disabled="isCurrentLibrary(library)"
                :aria-pressed="selectedLibraryId === library.id"
                @click="selectLibrary(library)"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <AppIcon
                    :icon="library.icon"
                    fallback="BookCopy"
                    :size="15"
                    :class="selectedLibraryId === library.id ? 'text-primary' : 'text-muted-foreground'"
                  />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                    {{ library.name }}
                    <span v-if="isCurrentLibrary(library)" class="rounded-full bg-muted px-2 py-0.5 text-[0.68rem] font-medium text-muted-foreground">
                      {{ t('book.move.currentLibrary') }}
                    </span>
                  </span>
                  <span class="block text-xs text-muted-foreground">
                    {{ t('book.move.folderCount', { count: folderCount(library) }) }}
                  </span>
                </span>
                <Check v-if="selectedLibraryId === library.id" :size="16" class="text-primary shrink-0" />
              </button>

              <!-- Folder cascade, shown only when the library has several roots -->
              <ul v-if="selectedLibraryId === library.id && folderCount(library) > 1" class="ms-10 mt-1 space-y-1 border-s-2 border-primary/20 ps-3">
                <li v-for="folder in library.folders" :key="folder.id">
                  <button
                    type="button"
                    class="w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors"
                    :class="selectedFolderId === folder.id ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted'"
                    :aria-pressed="selectedFolderId === folder.id"
                    @click="selectFolder(folder.id)"
                  >
                    <span class="font-mono">{{ folder.path }}</span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>

          <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" @click="handleClose">{{ t('common.cancel') }}</Button>
            <Button :disabled="!canSubmit" @click="handleContinue">
              <Loader2 v-if="move.previewLoading.value" :size="14" class="mr-1 animate-spin" />
              {{ t('book.move.continue') }}
            </Button>
          </div>
        </template>

        <!-- Step 2: review what will change -->
        <template v-else-if="move.step.value === 'review' && move.preview.value">
          <div class="flex flex-wrap gap-1.5">
            <span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {{ t('book.move.review.ready', { count: move.preview.value.readyCount }) }}
            </span>
            <span v-if="move.preview.value.collisionCount > 0" class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
              {{ t('book.move.review.collisions', { count: move.preview.value.collisionCount }) }}
            </span>
            <span v-if="move.preview.value.ineligibleCount > 0" class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
              {{ t('book.move.review.ineligible', { count: move.preview.value.ineligibleCount }) }}
            </span>
            <span
              v-if="move.preview.value.alreadyInTargetCount > 0"
              class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {{ t('book.move.review.alreadyThere', { count: move.preview.value.alreadyInTargetCount }) }}
            </span>
          </div>

          <!-- Consequences that outlive the move -->
          <div
            v-if="
              move.preview.value.warnings.accessLosers.length > 0 ||
              move.preview.value.warnings.koboImpact.length > 0 ||
              move.preview.value.warnings.layout ||
              move.preview.value.warnings.crossDevice
            "
            class="space-y-2 rounded-md bg-muted/60 px-3 py-2.5"
          >
            <p
              v-for="loser in move.preview.value.warnings.accessLosers"
              :key="`access-${loser.userId}`"
              class="flex items-start gap-2 text-xs text-foreground"
            >
              <Users :size="13" class="mt-0.5 shrink-0 text-muted-foreground" />
              {{ t('book.move.warning.accessLoss', { user: loser.username, count: loser.bookCount }) }}
            </p>
            <p
              v-for="impact in move.preview.value.warnings.koboImpact"
              :key="`kobo-${impact.userId}`"
              class="flex items-start gap-2 text-xs text-foreground"
            >
              <Smartphone :size="13" class="mt-0.5 shrink-0 text-muted-foreground" />
              {{ t('book.move.warning.koboImpact', { user: impact.username, count: impact.bookCount }) }}
            </p>
            <p v-if="move.preview.value.warnings.layout" class="flex items-start gap-2 text-xs text-foreground">
              <FolderInput :size="13" class="mt-0.5 shrink-0 text-muted-foreground" />
              {{
                t(`book.move.warning.layout.${move.preview.value.warnings.layout.change}`, {
                  count: move.preview.value.warnings.layout.bookCount,
                })
              }}
            </p>
            <p v-if="move.preview.value.warnings.crossDevice" class="flex items-start gap-2 text-xs text-foreground">
              <AlertTriangle :size="13" class="mt-0.5 shrink-0 text-muted-foreground" />
              {{ t('book.move.warning.crossDevice') }}
            </p>
          </div>

          <!-- Collisions needing a decision -->
          <div v-if="move.preview.value.collisions.length > 0" class="space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">{{ t('book.move.review.collisionsHeading') }}</p>
              <div class="flex gap-1">
                <Button size="sm" :variant="move.jobPolicy.value === 'suggested' ? 'default' : 'outline'" @click="handleSuggestedAll">
                  {{ t('book.move.policy.suggested') }}
                </Button>
                <Button size="sm" :variant="move.jobPolicy.value === 'keep_both' ? 'default' : 'outline'" @click="handleKeepBothAll">
                  {{ t('book.move.policy.keep_both') }}
                </Button>
                <Button size="sm" :variant="move.jobPolicy.value === 'merge' ? 'default' : 'outline'" @click="handleMergeAll">
                  {{ t('book.move.policy.merge') }}
                </Button>
                <Button size="sm" :variant="move.jobPolicy.value === 'skip' ? 'default' : 'outline'" @click="handleSkipAll">
                  {{ t('book.move.policy.skip') }}
                </Button>
              </div>
            </div>

            <ul class="space-y-1.5">
              <li v-for="collision in move.preview.value.collisions" :key="collision.bookId" class="rounded-md border border-border px-3 py-2">
                <p class="text-sm font-medium text-foreground">{{ collision.title }}</p>
                <p class="truncate font-mono text-[0.68rem] text-muted-foreground">{{ collisionLabel(collision.kind) }}</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ t(`book.move.policy.${move.effectivePolicy(collision)}`) }}
                </p>
              </li>
            </ul>
            <p v-if="move.preview.value.collisionsTruncated" class="text-xs text-muted-foreground">
              {{ t('book.move.review.moreCollisions', { count: move.preview.value.collisionCount - move.preview.value.collisions.length }) }}
            </p>
          </div>

          <!-- Books that cannot move at all -->
          <div v-if="move.preview.value.ineligible.length > 0" class="space-y-2">
            <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">{{ t('book.move.review.ineligibleHeading') }}</p>
            <ul class="space-y-1">
              <li v-for="item in move.preview.value.ineligible" :key="item.bookId" class="rounded-md bg-muted/50 px-3 py-2">
                <p class="text-sm font-medium text-foreground">{{ item.title }}</p>
                <p class="text-xs text-muted-foreground">{{ ineligibleLabel(item.reason, item.detail) }}</p>
              </li>
            </ul>
          </div>

          <div class="flex items-center justify-between gap-2 border-t border-border pt-3">
            <Button variant="ghost" @click="handleBack">{{ t('book.move.back') }}</Button>
            <Button :disabled="move.movableCount.value === 0" @click="handleReviewConfirm">
              <ArrowRight :size="14" class="mr-1" />
              {{ t('book.move.confirm', { count: move.movableCount.value }) }}
            </Button>
          </div>
        </template>

        <!-- Step 3: progress -->
        <template v-else-if="move.step.value === 'progress'">
          <div class="space-y-2" role="status" aria-live="polite">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-sm font-medium text-foreground">{{ t('book.move.progress.label', { library: selectedLibrary?.name ?? '' }) }}</span>
              <span class="text-xs tabular-nums text-muted-foreground"
                >{{ move.progress.value?.processed ?? 0 }} / {{ move.progress.value?.total ?? 0 }}</span
              >
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-[width]"
                :style="{
                  width: `${move.progress.value && move.progress.value.total > 0 ? Math.round((move.progress.value.processed / move.progress.value.total) * 100) : 0}%`,
                }"
              />
            </div>
            <div class="flex items-center justify-between">
              <span v-if="move.progress.value && move.progress.value.failed > 0" class="text-xs font-medium text-destructive">
                {{ t('book.move.progress.failed', { count: move.progress.value.failed }) }}
              </span>
              <span v-else />
              <Button size="sm" variant="ghost" @click="handleCancel">{{ t('common.cancel') }}</Button>
            </div>
          </div>
        </template>

        <!-- Step 4: outcome -->
        <template v-else-if="move.step.value === 'done'">
          <div v-if="move.executeError.value" class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {{ move.executeError.value }}
          </div>
          <div v-else-if="move.summary.value" class="space-y-1" role="status">
            <p class="text-sm font-medium text-foreground">
              {{
                t('book.move.done.summary', { count: move.summary.value.succeeded + move.summary.value.merged, library: selectedLibrary?.name ?? '' })
              }}
            </p>
            <p v-if="move.summary.value.merged > 0" class="text-xs text-muted-foreground">
              {{ t('book.move.done.merged', { count: move.summary.value.merged }) }}
            </p>
            <p v-if="move.summary.value.skipped > 0" class="text-xs text-muted-foreground">
              {{ t('book.move.done.skipped', { count: move.summary.value.skipped }) }}
            </p>
            <p v-if="move.summary.value.failed > 0" class="text-xs text-destructive">
              {{ t('book.move.done.failed', { count: move.summary.value.failed }) }}
            </p>
          </div>

          <div class="flex justify-end border-t border-border pt-3">
            <Button @click="handleClose">{{ t('common.close') }}</Button>
          </div>
        </template>
      </div>
    </SheetContent>
  </Sheet>
</template>
