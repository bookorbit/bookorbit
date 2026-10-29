<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { ChevronDown, CircleCheck, Loader2, Lock, Redo2, Save, Undo2 } from '@lucide/vue'
import type { BookChapterWriteBack, BookFileWriteDisabledReason } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const props = defineProps<{
  dirty: boolean
  errorCount: number
  warningCount: number
  saving: boolean
  canUndo: boolean
  canRedo: boolean
  writeBack: BookChapterWriteBack | null
  writing: boolean
}>()

const lock = defineModel<boolean>('lock', { required: true })

const emit = defineEmits<{ save: []; saveAndWrite: []; writeFiles: []; discard: []; undo: []; redo: [] }>()

const { t } = useI18n()

const WRITE_REASON_KEYS: Record<BookFileWriteDisabledReason, string> = {
  library_disabled: 'book.detail.chapters.writeFiles.reasons.libraryDisabled',
  no_primary_file: 'book.detail.chapters.writeFiles.reasons.noFiles',
  format_not_supported: 'book.detail.chapters.writeFiles.reasons.formatNotSupported',
  format_disabled: 'book.detail.chapters.writeFiles.reasons.formatDisabled',
  file_exceeds_size_limit: 'book.detail.chapters.writeFiles.reasons.tooLarge',
}

/** Below this the bar keeps one line: redo and discard move into the save menu, the toggle loses its label. */
const COMPACT_PX = 520
const root = ref<HTMLElement | null>(null)
const { width } = useElementSize(root)
const compact = computed(() => width.value > 0 && width.value < COMPACT_PX)

const canSave = computed(() => props.dirty && !props.saving && !props.writing && props.errorCount === 0)
const canWrite = computed(() => Boolean(props.writeBack?.available) && !props.saving && !props.writing)
const writeReason = computed(() => (props.writeBack?.reason ? t(WRITE_REASON_KEYS[props.writeBack.reason]) : null))

function handleSave() {
  emit('save')
}
function handleSaveAndWrite() {
  emit('saveAndWrite')
}
function handleWriteFiles() {
  emit('writeFiles')
}
function handleDiscard() {
  emit('discard')
}
function handleUndo() {
  emit('undo')
}
function handleRedo() {
  emit('redo')
}
function handleLock(value: boolean) {
  lock.value = value
}
</script>

<template>
  <div
    ref="root"
    class="sticky bottom-0 z-10 flex items-center rounded-xl border border-border bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75"
    :class="compact ? 'gap-2 py-2 pe-2 ps-3' : 'flex-wrap gap-x-4 gap-y-2 px-3.5 py-2.5'"
  >
    <p v-if="writing" class="flex min-w-0 items-center gap-2 text-sm text-foreground" :class="{ 'flex-1': compact }" role="status">
      <Loader2 :size="14" class="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span class="truncate">{{ t('book.detail.chapters.writeFiles.writing') }}</span>
    </p>
    <p
      v-else-if="dirty && errorCount > 0"
      class="flex min-w-0 items-center gap-2 text-sm text-destructive"
      :class="{ 'flex-1': compact }"
      role="status"
    >
      <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-destructive" />
      <span class="truncate">{{ t('book.detail.chapters.save.blocked', { count: errorCount }) }}</span>
    </p>
    <p v-else-if="dirty" class="flex min-w-0 items-center gap-2 text-sm text-foreground" :class="{ 'flex-1': compact }" role="status">
      <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-warning" />
      <span class="truncate">{{
        warningCount > 0 ? t('book.detail.chapters.save.unsavedWithWarnings', { count: warningCount }) : t('book.detail.chapters.save.unsaved')
      }}</span>
    </p>
    <p v-else class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground" :class="{ 'flex-1': compact }" role="status">
      <CircleCheck :size="14" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ t('book.detail.chapters.save.upToDate') }}</span>
    </p>

    <div class="flex items-center gap-1">
      <button
        class="inline-flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        :disabled="!canUndo"
        :aria-label="t('book.detail.chapters.undo')"
        :title="t('book.detail.chapters.undo')"
        @click="handleUndo"
      >
        <Undo2 class="size-4" aria-hidden="true" />
      </button>
      <button
        v-if="!compact"
        class="inline-flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        :disabled="!canRedo"
        :aria-label="t('book.detail.chapters.redo')"
        :title="t('book.detail.chapters.redo')"
        @click="handleRedo"
      >
        <Redo2 class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div class="flex items-center justify-end gap-2" :class="compact ? 'shrink-0' : 'ms-auto flex-wrap'">
      <label class="flex items-center gap-2 text-[13px] text-foreground" :title="t('book.detail.chapters.save.lockHint')">
        <ToggleSwitch :model-value="lock" @update:model-value="handleLock" />
        <Lock v-if="compact" class="size-3.5" aria-hidden="true" />
        <span :class="compact ? 'sr-only' : ''">{{ t('book.detail.chapters.save.lock') }}</span>
      </label>
      <Button v-if="!compact" variant="ghost" size="sm" type="button" :disabled="!dirty || saving" @click="handleDiscard">
        {{ t('book.detail.chapters.save.discard') }}
      </Button>
      <div class="flex items-center">
        <Button size="sm" type="button" class="rounded-e-none" :disabled="!canSave" @click="handleSave">
          <Loader2 v-if="saving" :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <Save v-else :size="14" aria-hidden="true" />
          {{ compact ? t('book.detail.chapters.save.short') : t('book.detail.chapters.save.action') }}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              size="sm"
              type="button"
              class="rounded-s-none border-s border-primary-foreground/25 px-2"
              :disabled="saving || writing"
              :aria-label="t('book.detail.chapters.writeFiles.more')"
            >
              <ChevronDown :size="14" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="max-w-72">
            <template v-if="compact">
              <DropdownMenuItem :disabled="!canRedo" @click="handleRedo">{{ t('book.detail.chapters.redo') }}</DropdownMenuItem>
              <DropdownMenuItem :disabled="!dirty || saving" @click="handleDiscard">{{ t('book.detail.chapters.save.discard') }}</DropdownMenuItem>
              <DropdownMenuSeparator />
            </template>
            <DropdownMenuItem :disabled="!canWrite || !canSave" @click="handleSaveAndWrite">
              {{ t('book.detail.chapters.writeFiles.saveAndWrite') }}
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="!canWrite || dirty" @click="handleWriteFiles">
              {{ t('book.detail.chapters.writeFiles.writeSaved') }}
            </DropdownMenuItem>
            <DropdownMenuLabel v-if="writeReason" class="text-xs font-normal leading-snug text-muted-foreground">
              {{ writeReason }}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </div>
</template>
